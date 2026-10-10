import type {
  Attribution,
  ClaimKind,
  InferenceScheme,
  Modality,
  Origin,
  RunStatus,
} from '@make-your-case/domain';

/** Display text for domain enums, in one place so every panel says the same thing. */

export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  factual: 'Fact',
  legal_rule: 'Legal rule',
  normative: 'Normative',
  definitional: 'Definition',
  causal: 'Causal',
  predictive: 'Prediction',
};

export const MODALITY_LABELS: Record<Modality, string> = {
  asserted: 'Asserted',
  probable: 'Probable',
  possible: 'Possible',
  hedged: 'Hedged',
};

export const SCHEME_LABELS: Record<InferenceScheme, string> = {
  deductive: 'Deductive',
  causal: 'Causal',
  analogical: 'Analogical',
  abductive: 'Abductive',
  statistical: 'Statistical',
};

export const ORIGIN_LABELS: Record<Origin, string> = {
  stated: 'Stated by the author',
  inferred: 'Inferred by the system',
  user_added: 'Added by a user',
};

export const ATTRIBUTION_LABELS: Record<Attribution, string> = {
  author: 'Author',
  opposing: 'Opposing party',
  third_party: 'Third party',
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Analyzing',
  completed: 'Analyzed',
  not_an_argument: 'Not an argument',
  failed: 'Failed',
};
