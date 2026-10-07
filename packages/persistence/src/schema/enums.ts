import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enum types, mirroring `docs/argument-model.mermaid`.
 *
 * Adding a value here requires a migration. The domain Zod enums in
 * `@make-your-case/domain` are the other half of each pair; a mapper round-trip
 * test is what keeps them honest.
 */
export const documentRole = pgEnum('document_role', [
  'own_brief',
  'opposing_brief',
  'article',
  'other',
]);

export const spanFunction = pgEnum('span_function', [
  'argumentative',
  'narrative',
  'descriptive',
  'instructional',
  'rhetorical',
  'unclassified',
]);

export const runStatus = pgEnum('run_status', [
  'queued',
  'running',
  'completed',
  'not_an_argument',
  'failed',
]);

export const pipelineStage = pgEnum('pipeline_stage', [
  'segment',
  'classify',
  'extract',
  'reconstruct',
  'validate',
  'analyze',
  'persist',
]);

export const runEventType = pgEnum('run_event_type', [
  'stage_started',
  'stage_progress',
  'stage_completed',
  'validation_retry',
  'run_failed',
]);

export const claimKind = pgEnum('claim_kind', [
  'factual',
  'legal_rule',
  'normative',
  'definitional',
  'causal',
  'predictive',
]);

export const modality = pgEnum('modality', ['asserted', 'probable', 'possible', 'hedged']);

export const origin = pgEnum('origin', ['stated', 'inferred', 'user_added']);

export const attribution = pgEnum('attribution', ['author', 'opposing', 'third_party']);

export const inferenceScheme = pgEnum('inference_scheme', [
  'deductive',
  'causal',
  'analogical',
  'abductive',
  'statistical',
]);

export const relationType = pgEnum('relation_type', ['rebut', 'undermine', 'undercut', 'qualify']);

export const findingKind = pgEnum('finding_kind', [
  'invalid_step',
  'unchecked_step',
  'circularity',
  'unsupported_claim',
  'load_bearing',
  'implicit_premise',
  'unconnected_claim',
]);

export const severity = pgEnum('severity', ['info', 'warning', 'critical']);
