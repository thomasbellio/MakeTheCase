import type { ClaimId, FindingId, InferenceId, SpanId } from '@make-your-case/domain';
import { targetRef, type ArgumentIndex } from './argument-index.ts';

/** What the user has picked, in whichever panel they picked it (AGENTS.md section 9.2). */
export type Selection =
  | { readonly type: 'claim'; readonly id: ClaimId }
  | { readonly type: 'inference'; readonly id: InferenceId }
  | { readonly type: 'span'; readonly id: SpanId }
  | { readonly type: 'finding'; readonly id: FindingId };

/** Everything every panel should light up for one selection. */
export interface Highlight {
  readonly claims: ReadonlySet<ClaimId>;
  readonly inferences: ReadonlySet<InferenceId>;
  readonly spans: ReadonlySet<SpanId>;
}

export const NO_HIGHLIGHT: Highlight = {
  claims: new Set(),
  inferences: new Set(),
  spans: new Set(),
};

/**
 * Selection syncing as one pure function:
 *
 * - a **span** lights up the claims it supports;
 * - a **claim** lights up the spans it was stated in;
 * - an **inference** lights up its premises and conclusion, and their spans;
 * - a **finding** lights up its targets, and their spans.
 *
 * Inferred claims have no spans, so selecting one highlights nothing in the
 * source — which is the honest answer: the author never said it.
 */
export function highlightFor(index: ArgumentIndex, selection: Selection | null): Highlight {
  if (selection === null) return NO_HIGHLIGHT;

  const claims = new Set<ClaimId>();
  const inferences = new Set<InferenceId>();
  const spans = new Set<SpanId>();

  const addInference = (id: InferenceId): void => {
    const inference = index.inferenceById.get(id);
    if (inference === undefined) return;
    inferences.add(id);
    for (const premise of index.premisesOf.get(id) ?? []) claims.add(premise);
    claims.add(inference.conclusion_claim_id);
  };

  switch (selection.type) {
    case 'span':
      if (!index.spanById.has(selection.id)) return NO_HIGHLIGHT;
      spans.add(selection.id);
      for (const claim of index.claimsInSpan.get(selection.id) ?? []) claims.add(claim);
      break;
    case 'claim':
      if (index.claimById.has(selection.id)) claims.add(selection.id);
      break;
    case 'inference':
      addInference(selection.id);
      break;
    case 'finding': {
      const finding = index.findings.find((f) => f.id === selection.id);
      for (const target of finding?.targets ?? []) {
        const ref = targetRef(target);
        if (ref.kind === 'claim') {
          if (index.claimById.has(ref.id)) claims.add(ref.id);
        } else {
          addInference(ref.id);
        }
      }
      break;
    }
  }

  for (const claim of claims) {
    for (const occurrence of index.occurrencesOf.get(claim) ?? []) spans.add(occurrence.span_id);
  }
  return { claims, inferences, spans };
}

/** The span to scroll the source text to: the earliest highlighted one. */
export function firstSpan(index: ArgumentIndex, highlight: Highlight): SpanId | null {
  return index.spans.find((span) => highlight.spans.has(span.id))?.id ?? null;
}

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  return a?.type === b?.type && a?.id === b?.id;
}
