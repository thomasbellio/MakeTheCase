import { z } from 'zod';
import { documentIdSchema, runIdSchema } from '../ids.ts';
import { documentRoleSchema, runStatusSchema } from '../enums.ts';
import { documentSchema, documentSummarySchema } from '../entities/document.ts';
import { spanSchema } from '../entities/span.ts';
import { analysisRunSchema, runEventSchema } from '../entities/run.ts';
import { argumentGraphSchema, type ArgumentGraph } from '../graph/argument-graph.ts';

/**
 * Request and response bodies for the HTTP API (AGENTS.md section 8.6).
 *
 * Entities use `z.date()`, which JSON cannot carry, so each wire schema swaps
 * its date fields for `isoDate`: an ISO-8601 string on the wire and a `Date`
 * once decoded. The server writes bodies with `z.encode(schema, value)` and the
 * client reads them with `z.decode(schema, json)`, so both sides see the same
 * domain types and neither hand-converts dates.
 *
 * Entity responses keep the domain's snake_case. The two bodies §8.6 spells
 * out in camelCase — the submit request and its response — are camelCase.
 */

/** Any wire schema, and its decoded type — so `apps/web` can be generic over them without zod. */
export type WireSchema = z.ZodType;
export type WireOutput<S extends WireSchema> = z.output<S>;

/**
 * Encodes a domain value into its JSON-safe wire form. Exported so that
 * `apps/web`, which may not import zod (AGENTS.md section 4), needs no zod of
 * its own to use these schemas.
 */
export function encodeWire<S extends z.ZodType>(schema: S, value: z.output<S>): z.input<S> {
  return z.encode(schema, value);
}

/** Decodes and validates a wire body into domain types; throws on a mismatch. */
export function decodeWire<S extends z.ZodType>(schema: S, json: unknown): z.output<S> {
  return z.decode(schema, json as z.input<S>);
}

/** Validates an untrusted value, without throwing. */
export function parseWire<S extends z.ZodType>(
  schema: S,
  value: unknown,
): { ok: true; value: z.output<S> } | { ok: false; message: string } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  // Names paths and messages only — never the input, which may be document text.
  const message = result.error.issues
    .map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
    )
    .join('; ');
  return { ok: false, message };
}

export const isoDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (value) => new Date(value),
  encode: (date) => date.toISOString(),
});

export const documentWireSchema = documentSchema
  .unwrap()
  .extend({ created_at: isoDate })
  .readonly();

export const documentSummaryWireSchema = documentSummarySchema
  .unwrap()
  .extend({ created_at: isoDate })
  .readonly();

// `unwrap` drops the entity's not_an_argument-needs-a-summary refinement; the
// server only ever encodes runs that passed through the repository, which
// already enforces it.
export const analysisRunWireSchema = analysisRunSchema
  .unwrap()
  .extend({ started_at: isoDate.nullable(), finished_at: isoDate.nullable() })
  .readonly();

export const runEventWireSchema = runEventSchema
  .unwrap()
  .extend({ created_at: isoDate })
  .readonly();

// --- POST /api/documents -----------------------------------------------------

export const createDocumentRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(500).nullish(),
    role: documentRoleSchema.optional(),
    sourceText: z.string().refine((text) => text.trim().length > 0, {
      message: 'the text to analyze must not be empty',
    }),
  })
  .readonly();
export type CreateDocumentRequest = z.input<typeof createDocumentRequestSchema>;

export const createDocumentResponseSchema = z
  .object({ documentId: documentIdSchema, runId: runIdSchema })
  .readonly();
export type CreateDocumentResponse = z.infer<typeof createDocumentResponseSchema>;

// --- GET /api/documents ------------------------------------------------------

export const documentListResponseSchema = z.array(documentSummaryWireSchema);

// --- GET /api/documents/:id --------------------------------------------------

/**
 * A document, its spans, and its most recent run. `latestRun` is how the
 * document page knows which run's events to stream, and whether there is an
 * argument to fetch yet.
 */
export const documentDetailResponseSchema = z
  .object({
    document: documentWireSchema,
    spans: z.array(spanSchema),
    latestRun: analysisRunWireSchema.nullable(),
  })
  .readonly();
export type DocumentDetail = z.output<typeof documentDetailResponseSchema>;

// --- GET /api/documents/:id/argument -----------------------------------------

/** The graph carries no dates, so its wire form is the entity schema itself. */
export const argumentResponseSchema = argumentGraphSchema;

/**
 * Decodes an argument response into the declared `ArgumentGraph`.
 *
 * Typed against the declared interface (`Finding` is hand-written; see
 * `entities/finding.ts`), so callers never handle the schema's inferred shape.
 */
export function decodeArgumentResponse(json: unknown): ArgumentGraph {
  return argumentResponseSchema.parse(json);
}

/** The inverse of `decodeArgumentResponse`; validates before encoding, as `encodeWire` does. */
export function encodeArgumentResponse(graph: ArgumentGraph): unknown {
  // The declared interface uses readonly arrays where the schema's output has
  // mutable ones; encoding never mutates, so the widening is safe.
  return z.encode(argumentResponseSchema, graph as z.output<typeof argumentResponseSchema>);
}

// --- GET /api/runs/:id -------------------------------------------------------

export const runResponseSchema = analysisRunWireSchema;

// --- GET /api/runs/:id/events (Server-Sent Events) ---------------------------

/**
 * The stream sends one unnamed (`message`) event per `RunEvent`, with `id:` set
 * to its sequence so a reconnect resumes from `Last-Event-ID`; and one final
 * `end` event, after which the server closes the stream. A client that
 * reconnects by hand passes `?after=<sequence>`, because a new `EventSource`
 * cannot set the header itself.
 */
export const RUN_STREAM_END_EVENT = 'end';

export const runStreamEndSchema = z.object({ status: runStatusSchema }).readonly();
export type RunStreamEnd = z.infer<typeof runStreamEndSchema>;

// --- Errors ------------------------------------------------------------------

export const apiErrorCodeSchema = z.enum([
  'validation_failed',
  'document_too_large',
  'not_found',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** Every non-2xx body. `message` is safe to show the user. */
export const apiErrorResponseSchema = z
  .object({
    error: z.object({ code: apiErrorCodeSchema, message: z.string() }).readonly(),
  })
  .readonly();
export type ApiError = z.infer<typeof apiErrorResponseSchema>['error'];
