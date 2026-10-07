import { z } from 'zod';
import { documentIdSchema, revisionIdSchema, runEventIdSchema, runIdSchema } from '../ids.ts';
import { pipelineStageSchema, runEventTypeSchema, runStatusSchema } from '../enums.ts';

/**
 * One execution of the pipeline over a document.
 *
 * `summary` is a short genre description, required when the status is
 * `not_an_argument` so the UI can explain what the text appears to be.
 * `error` is a separate, user-safe failure message — the two are not
 * interchangeable.
 */
export const analysisRunSchema = z
  .object({
    id: runIdSchema,
    document_id: documentIdSchema,
    revision_id: revisionIdSchema.nullable(),
    status: runStatusSchema,
    current_stage: pipelineStageSchema.nullable(),
    summary: z.string().nullable(),
    model_config: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    started_at: z.date().nullable(),
    finished_at: z.date().nullable(),
  })
  .readonly()
  .refine((run) => run.status !== 'not_an_argument' || run.summary !== null, {
    message: 'a not_an_argument run must carry a summary describing what the text appears to be',
    path: ['summary'],
  });
export type AnalysisRun = z.infer<typeof analysisRunSchema>;

export const newAnalysisRunSchema = z
  .object({
    document_id: documentIdSchema,
    status: runStatusSchema.default('queued'),
  })
  .readonly();
export type NewAnalysisRun = z.infer<typeof newAnalysisRunSchema>;

/** A status transition. Every field is optional so callers patch only what moved. */
export const runStatusUpdateSchema = z
  .object({
    status: runStatusSchema.optional(),
    current_stage: pipelineStageSchema.nullable().optional(),
    summary: z.string().nullable().optional(),
    model_config: z.record(z.string(), z.unknown()).nullable().optional(),
    error: z.string().nullable().optional(),
    revision_id: revisionIdSchema.nullable().optional(),
    started_at: z.date().nullable().optional(),
    finished_at: z.date().nullable().optional(),
  })
  .readonly();
export type RunStatusUpdate = z.infer<typeof runStatusUpdateSchema>;

/**
 * A progress event. `sequence` is monotonic per run, which is what lets the SSE
 * stream resume from `Last-Event-ID`.
 *
 * Payloads must be safe to show users: no raw prompts, no API keys, no stack
 * traces (AGENTS.md section 8.4).
 */
export const runEventSchema = z
  .object({
    id: runEventIdSchema,
    run_id: runIdSchema,
    sequence: z.number().int().min(0),
    stage: pipelineStageSchema.nullable(),
    type: runEventTypeSchema,
    payload: z.record(z.string(), z.unknown()).nullable(),
    created_at: z.date(),
  })
  .readonly();
export type RunEvent = z.infer<typeof runEventSchema>;

export const newRunEventSchema = z
  .object({
    run_id: runIdSchema,
    stage: pipelineStageSchema.nullable().default(null),
    type: runEventTypeSchema,
    payload: z.record(z.string(), z.unknown()).nullable().default(null),
  })
  .readonly();
export type NewRunEvent = z.infer<typeof newRunEventSchema>;
