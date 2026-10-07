import type { AnalysisFinding, ArgumentGraphView, ClaimView } from '@make-your-case/domain';
import type { GraphIndex } from '../graph/index-graph.ts';
import type { SupportModel } from '../graph/support.ts';
import type { SupportCycle } from '../graph/cycles.ts';

/**
 * Everything an analyzer may read, computed once per run.
 *
 * Sharing the support model here is what lets the analyzers stay independent of
 * each other: three of them need to know whether a claim is load-bearing, and
 * without this they would have to recover that from another analyzer's output,
 * which would make their order significant.
 */
export interface AnalysisContext<Id extends string> {
  readonly graph: ArgumentGraphView<Id>;
  readonly index: GraphIndex<Id>;
  readonly support: SupportModel<Id>;
  readonly cycles: readonly SupportCycle<Id>[];
  readonly thesis: ClaimView<Id>;
}

export interface Analyzer<Id extends string> {
  readonly name: string;
  readonly version: string;
  run(ctx: AnalysisContext<Id>): readonly AnalysisFinding<Id>[];
}

/** `produced_by` for a finding, e.g. `load-bearing@1.0.0`. */
export function producedBy(analyzer: { name: string; version: string }): string {
  return `${analyzer.name}@${analyzer.version}`;
}
