import type { AnalysisFinding } from '@make-your-case/domain';
import { findUnconnectedClaims } from '../../graph/connectivity.ts';
import { producedBy, type AnalysisContext, type Analyzer } from '../analyzer.ts';
import { claimText, q } from '../explain.ts';

/**
 * Claims that stand apart from the argument.
 *
 * Informational, not a defect: briefs state a standard of review or procedural
 * history without arguing from it. Uses the same predicate as the corresponding
 * validation warning, so the two cannot diverge.
 */
export const unconnectedClaimAnalyzer: Analyzer<string> = {
  name: 'unconnected-claim',
  version: '1.0.0',

  run<Id extends string>(ctx: AnalysisContext<Id>): readonly AnalysisFinding<Id>[] {
    return findUnconnectedClaims(ctx.graph, ctx.index).map((id) => ({
      kind: 'unconnected_claim' as const,
      severity: 'info' as const,
      explanation:
        `${q(claimText(ctx, id))} is not connected to the argument for ${q(ctx.thesis.canonical_text)}: ` +
        `it is not used as a premise, nothing supports it, and nothing attacks or qualifies it. ` +
        `Briefs often state background of this kind without arguing from it.`,
      produced_by: producedBy(unconnectedClaimAnalyzer),
      targets: [{ target: 'claim' as const, claim_id: id, ordinal: 0 }],
    }));
  },
};
