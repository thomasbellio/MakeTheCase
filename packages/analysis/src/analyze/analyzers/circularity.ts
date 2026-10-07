import type { AnalysisFinding } from '@make-your-case/domain';
import { producedBy, type AnalysisContext, type Analyzer } from '../analyzer.ts';
import { claimText, q } from '../explain.ts';

/**
 * Support that comes back round to where it started.
 *
 * One finding per circular chain, with the members in traversal order so the
 * explanation reads as a loop rather than a set.
 */
export const circularityAnalyzer: Analyzer<string> = {
  name: 'circularity',
  version: '1.0.0',

  run<Id extends string>(ctx: AnalysisContext<Id>): readonly AnalysisFinding<Id>[] {
    return ctx.cycles.map((cycle) => {
      const texts = cycle.claimIds.map((id) => q(claimText(ctx, id)));

      // Walk the loop and close it, so the last clause points back to the first
      // claim: "A rests on B, which rests on A."
      const steps = texts
        .slice(1)
        .map((text) => `which rests on reasoning from ${text}`)
        .join(', ');
      const closing = texts.length > 0 ? `, which rests on reasoning from ${texts[0] ?? ''}` : '';

      return {
        kind: 'circularity' as const,
        severity: 'critical' as const,
        explanation:
          `${texts[0] ?? ''} rests on reasoning from ${texts[1] ?? ''}` +
          (steps === '' ? '' : `, ${steps}`) +
          `${closing}. Nothing outside this chain supports any claim in it.`,
        produced_by: producedBy(circularityAnalyzer),
        targets: cycle.ordered,
      };
    });
  },
};
