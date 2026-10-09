import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, type BaseMessage, type BaseMessageLike } from '@langchain/core/messages';
import type { z } from 'zod';
import { looksTruncated, repairCandidates } from './repair.ts';

/** Calls per structured request before giving up on malformed output. */
export const STRUCTURED_OUTPUT_ATTEMPTS = 3;

/**
 * Thrown when a model's output still does not match the schema after every
 * attempt. The message names schema paths only: model output can echo
 * document text, which must never reach a log at info level (AGENTS.md
 * section 11).
 */
export class StructuredOutputError extends Error {
  override readonly name = 'StructuredOutputError';
}

/**
 * The only way stage code calls a model: one structured response, validated
 * against `schema`. `name` becomes the tool or schema name the provider sees.
 *
 * Models sometimes return output that fails the schema; the common case on
 * large nested responses is a top-level field whose value is JSON text rather
 * than JSON. The raw response is requested alongside the parsed one so such
 * output can be recovered rather than thrown away: `repairCandidates` proposes
 * several readings of the damage and the schema picks one. Only if none of them
 * validates is the request repeated.
 *
 * The error distinguishes damage from truncation, because they call for
 * different fixes — a prompt or schema change for the former, a larger output
 * budget or a shorter prompt for the latter.
 *
 * A repeated attempt is **not** the same request. Asking again identically
 * invites the same answer, which is what makes a deterministic malformation
 * fail all three attempts; so each retry carries a short note naming the schema
 * paths that did not match. The note names paths only, never the model's
 * output, which can echo document text (AGENTS.md section 11).
 */
export async function invokeStructured<Schema extends z.ZodType<Record<string, unknown>>>(
  model: BaseChatModel,
  schema: Schema,
  messages: readonly BaseMessageLike[],
  name: string,
): Promise<z.infer<Schema>> {
  const runnable = model.withStructuredOutput<z.infer<Schema>>(schema, { name, includeRaw: true });
  let problem = 'no output';
  let truncatedOutput = false;

  for (let attempt = 1; attempt <= STRUCTURED_OUTPUT_ATTEMPTS; attempt++) {
    const request =
      attempt === 1
        ? [...messages]
        : [...messages, new HumanMessage(correction(problem, truncatedOutput))];

    const { raw, parsed } = (await runnable.invoke(request)) as {
      raw: BaseMessage;
      parsed: z.infer<Schema> | null;
    };
    if (parsed !== null) return parsed;

    const args = rawArguments(raw);
    // Several readings of the damage; the schema is the arbiter. Lossless
    // readings are all tried before any that salvaged a truncated response, so
    // discarding part of the output is genuinely the last resort rather than an
    // accident of ordering.
    const candidates = repairCandidates(args);
    let best: z.ZodError | undefined;

    for (const lossless of [true, false]) {
      for (const candidate of candidates) {
        if (candidate.truncated === lossless) continue;
        const result = schema.safeParse(candidate.value);
        if (result.success) return result.data;
        // Report the nearest miss rather than the last one tried.
        if (best === undefined || result.error.issues.length < best.issues.length) {
          best = result.error;
        }
      }
    }

    truncatedOutput = truncatedOutput || isTruncated(args);
    problem = (best?.issues ?? [])
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
  }

  const cutShort = truncatedOutput
    ? ', and the output was cut short — the response may not fit the output budget'
    : '';
  throw new StructuredOutputError(
    `${name}: the model's output did not match the schema after ` +
      `${String(STRUCTURED_OUTPUT_ATTEMPTS)} attempts${cutShort} (${problem})`,
  );
}

/** The structured arguments in a raw response: a tool call's args, or JSON message content. */
export function rawArguments(raw: BaseMessage): unknown {
  const toolCall = (raw as { tool_calls?: { args?: unknown }[] }).tool_calls?.[0];
  if (toolCall?.args !== undefined) return toolCall.args;

  const content = raw.content;
  const text =
    typeof content === 'string'
      ? content
      : content
          .map((block) => (block.type === 'text' && 'text' in block ? String(block.text) : ''))
          .join('');
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The note a retry carries.
 *
 * Schema paths only. The model's own output is never quoted back to it: it can
 * contain document text, and this message is one edit away from being logged.
 */
function correction(problem: string, truncated: boolean): string {
  return [
    'Your previous response could not be read as the required structure.',
    truncated
      ? 'It stopped part way through, so it was probably too long: produce the same structure more concisely, with no field left incomplete.'
      : 'These fields did not match the schema: ' +
        `${problem}. Return every field as real JSON — an array must be a JSON array, not a string containing one — and return the whole object once.`,
  ].join(' ');
}

/**
 * Whether a response was cut short rather than merely malformed.
 *
 * Worth distinguishing in the error: truncation means the response did not fit
 * the output budget, which no amount of schema or prompt tightening fixes.
 */
function isTruncated(args: unknown): boolean {
  if (typeof args === 'string') return looksTruncated(args);
  if (typeof args !== 'object' || args === null) return false;

  return Object.values(args).some(
    (field) => typeof field === 'string' && /^\s*[[{]/.test(field) && looksTruncated(field),
  );
}
