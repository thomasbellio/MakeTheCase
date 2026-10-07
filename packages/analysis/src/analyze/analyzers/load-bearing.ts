import type { AnalysisFinding } from '@make-your-case/domain';
import { producedBy, type AnalysisContext, type Analyzer } from '../analyzer.ts';
import { q } from '../explain.ts';

/**
 * Claims the thesis cannot do without.
 *
 * The thesis itself is never reported: removing it trivially leaves itself
 * unsupported, so a finding about it would say nothing — and the degenerate
 * single-claim graph that section 7.3 allows would otherwise produce one.
 */
export const loadBearingAnalyzer: Analyzer<string> = {
  name: 'load-bearing',
  version: '1.0.0',

  run<Id extends string>(ctx: AnalysisContext<Id>): readonly AnalysisFinding<Id>[] {
    if (!ctx.support.thesisSupported) return [];

    return ctx.graph.claims
      .filter((claim) => ctx.support.loadBearingClaimIds.has(claim.id))
      .map((claim) => {
        // A claim that only holds because its own cycle was assumed is worth
        // saying out loud: it is load-bearing and ungrounded at once.
        const circular =
          ctx.support.seedClaimIds.has(claim.id) && !ctx.support.derivable.has(claim.id);

        return {
          kind: 'load_bearing' as const,
          severity: 'info' as const,
          explanation:
            `Without ${q(claim.canonical_text)} nothing in the argument supports ${q(ctx.thesis.canonical_text)}.` +
            (circular
              ? ' This claim is itself supported only by reasoning that depends on it in turn.'
              : ''),
          produced_by: producedBy(loadBearingAnalyzer),
          targets: [{ target: 'claim' as const, claim_id: claim.id, ordinal: 0 }],
        };
      });
  },
};
