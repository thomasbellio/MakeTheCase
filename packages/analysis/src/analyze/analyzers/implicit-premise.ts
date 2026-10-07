import type { AnalysisFinding, FindingTarget } from '@make-your-case/domain';
import { producedBy, type AnalysisContext, type Analyzer } from '../analyzer.ts';
import { claimText, list, q } from '../explain.ts';

/**
 * Premises the author relied on but never stated.
 *
 * Reported per claim rather than per inference: an inferred premise shared by
 * two routes is one gap in the argument, not two. Severity rises to `critical`
 * when the premise is also load-bearing, because then the argument does not
 * stand without something the reader was never told.
 */
export const implicitPremiseAnalyzer: Analyzer<string> = {
  name: 'implicit-premise',
  version: '1.0.0',

  run<Id extends string>(ctx: AnalysisContext<Id>): readonly AnalysisFinding<Id>[] {
    const findings: AnalysisFinding<Id>[] = [];

    for (const claim of ctx.graph.claims) {
      if (claim.origin !== 'inferred') continue;

      const usedBy = (ctx.index.premiseOf.get(claim.id) ?? []).filter((id) =>
        ctx.support.authorInferenceIds.has(id),
      );
      // An inferred claim that is only ever a conclusion is not a premise the
      // argument leans on, so it is not reported here.
      if (usedBy.length === 0) continue;

      const isLoadBearing = ctx.support.loadBearingClaimIds.has(claim.id);
      const conclusions = usedBy.map((id) =>
        q(claimText(ctx, ctx.index.inferenceById.get(id)?.conclusion_claim_id ?? claim.id)),
      );

      const lead =
        usedBy.length === 1
          ? `The step to ${conclusions[0] ?? ''} relies on a premise the text does not state: ${q(claim.canonical_text)}.`
          : `The steps to ${list(conclusions)} rely on a premise the text does not state: ${q(claim.canonical_text)}.`;

      const consequence = isLoadBearing
        ? ` The argument for ${q(ctx.thesis.canonical_text)} does not hold without it.`
        : ` The conclusion has other stated routes of support, so the argument does not rest on this premise alone.`;

      const targets: FindingTarget<Id>[] = [
        { target: 'claim', claim_id: claim.id, ordinal: 0 },
        ...usedBy.map((id, i): FindingTarget<Id> => ({
          target: 'inference',
          inference_id: id,
          ordinal: i + 1,
        })),
      ];

      findings.push({
        kind: 'implicit_premise',
        severity: isLoadBearing ? 'critical' : 'warning',
        explanation: lead + consequence,
        produced_by: producedBy(implicitPremiseAnalyzer),
        targets,
      });
    }

    return findings;
  },
};
