import { z } from 'zod';

/**
 * Every enumeration in the argument model (AGENTS.md section 6).
 *
 * These mirror `docs/argument-model.mermaid`. Adding a value here means adding
 * it to the Drizzle enum type and a migration in `@make-your-case/persistence`.
 */

export const documentRoleSchema = z.enum(['own_brief', 'opposing_brief', 'article', 'other']);
export type DocumentRole = z.infer<typeof documentRoleSchema>;

export const spanFunctionSchema = z.enum([
  'argumentative',
  'narrative',
  'descriptive',
  'instructional',
  'rhetorical',
  'unclassified',
]);
export type SpanFunction = z.infer<typeof spanFunctionSchema>;

export const runStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'not_an_argument',
  'failed',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const pipelineStageSchema = z.enum([
  'segment',
  'classify',
  'extract',
  'reconstruct',
  'validate',
  'analyze',
  'persist',
]);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const runEventTypeSchema = z.enum([
  'stage_started',
  'stage_progress',
  'stage_completed',
  'validation_retry',
  'run_failed',
]);
export type RunEventType = z.infer<typeof runEventTypeSchema>;

export const claimKindSchema = z.enum([
  'factual',
  'legal_rule',
  'normative',
  'definitional',
  'causal',
  'predictive',
]);
export type ClaimKind = z.infer<typeof claimKindSchema>;

export const modalitySchema = z.enum(['asserted', 'probable', 'possible', 'hedged']);
export type Modality = z.infer<typeof modalitySchema>;

export const originSchema = z.enum(['stated', 'inferred', 'user_added']);
export type Origin = z.infer<typeof originSchema>;

/**
 * Who asserts a claim or inference (AGENTS.md section 6).
 *
 * Opposing and third-party material never supports the author's thesis; it
 * enters the graph through relations and through the other party's own
 * inferences. Inferred content is always `author`.
 */
export const attributionSchema = z.enum(['author', 'opposing', 'third_party']);
export type Attribution = z.infer<typeof attributionSchema>;

export const inferenceSchemeSchema = z.enum([
  'deductive',
  'causal',
  'analogical',
  'abductive',
  'statistical',
]);
export type InferenceScheme = z.infer<typeof inferenceSchemeSchema>;

export const relationTypeSchema = z.enum(['rebut', 'undermine', 'undercut', 'qualify']);
export type RelationType = z.infer<typeof relationTypeSchema>;

export const findingKindSchema = z.enum([
  'invalid_step',
  'unchecked_step',
  'circularity',
  'unsupported_claim',
  'load_bearing',
  'implicit_premise',
  'unconnected_claim',
]);
export type FindingKind = z.infer<typeof findingKindSchema>;

export const severitySchema = z.enum(['info', 'warning', 'critical']);
export type Severity = z.infer<typeof severitySchema>;
