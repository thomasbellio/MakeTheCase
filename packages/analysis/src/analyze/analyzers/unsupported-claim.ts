import type { AnalysisFinding } from '@make-your-case/domain';
import { producedBy, type AnalysisContext, type Analyzer } from '../analyzer.ts';
import { q } from '../explain.ts';

/** Claim kinds a reader can reasonably expect a source for. */
const EVIDENTIAL_KINDS = new Set(['factual', 'causal', 'predictive']);

/**
 * What the argument asks the reader to simply accept.
 *
 * A starting-point claim of the author's, load-bearing, of a kind that invites
 * a source, and offering none. Inferred claims are excluded: they can never
 * carry a citation and are already reported as `implicit_premise`, so including
 * them would describe the same gap twice.
 */
export const unsupportedClaimAnalyzer: Analyzer<string> = {
  name: 'unsupported-claim',
  version: '1.0.0',

  run<Id extends string>(ctx: AnalysisContext<Id>): readonly AnalysisFinding<Id>[] {
    return ctx.graph.claims
      .filter(
        (claim) =>
          claim.attribution === 'author' &&
          claim.origin === 'stated' &&
          !claim.is_thesis &&
          claim.citation === null &&
          EVIDENTIAL_KINDS.has(claim.kind) &&
          ctx.support.groundClaimIds.has(claim.id) &&
          ctx.support.loadBearingClaimIds.has(claim.id),
      )
      .map((claim) => ({
        kind: 'unsupported_claim' as const,
        severity: 'warning' as const,
        explanation:
          `${q(claim.canonical_text)} is offered without a citation to the record or to legal authority, ` +
          `and the argument for ${q(ctx.thesis.canonical_text)} does not hold without it. ` +
          `The reader is asked to accept it as given.`,
        produced_by: producedBy(unsupportedClaimAnalyzer),
        targets: [{ target: 'claim' as const, claim_id: claim.id, ordinal: 0 }],
      }));
  },
};
