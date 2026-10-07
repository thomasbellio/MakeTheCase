import type { AnalysisFinding, ArgumentGraphView } from '@make-your-case/domain';
import { indexGraph } from '../graph/index-graph.ts';
import { buildSupportModel } from '../graph/support.ts';
import type { AnalysisContext, Analyzer } from './analyzer.ts';
import { implicitPremiseAnalyzer } from './analyzers/implicit-premise.ts';
import { loadBearingAnalyzer } from './analyzers/load-bearing.ts';
import { circularityAnalyzer } from './analyzers/circularity.ts';
import { unsupportedClaimAnalyzer } from './analyzers/unsupported-claim.ts';
import { unconnectedClaimAnalyzer } from './analyzers/unconnected-claim.ts';
import { deductiveValidityAnalyzer } from './analyzers/deductive-validity.ts';

/**
 * Declared order. Analyzers do not depend on one another — everything shared
 * lives in the context — so this order only fixes the order of the output,
 * which the tests assert on.
 */
export const ANALYZERS: readonly Analyzer<string>[] = [
  implicitPremiseAnalyzer,
  loadBearingAnalyzer,
  circularityAnalyzer,
  unsupportedClaimAnalyzer,
  unconnectedClaimAnalyzer,
  deductiveValidityAnalyzer,
];

/**
 * Runs every analyzer over an argument graph (AGENTS.md section 7.3).
 *
 * Pure and deterministic: no I/O, no LLM calls, and the same graph always
 * yields the same findings in the same order.
 *
 * Generic over the ID type because the pipeline analyzes before it persists
 * (section 8.2), so findings are emitted against local IDs and mapped to UUIDs
 * afterwards. The same function can therefore regenerate findings for a stored
 * revision.
 *
 * A graph with no thesis yields no findings: every explanation is phrased in
 * terms of what the argument is for, and validation rejects a thesis-less graph
 * before this is reached.
 */
export function analyzeArgumentGraph<Id extends string>(
  graph: ArgumentGraphView<Id>,
): readonly AnalysisFinding<Id>[] {
  const index = indexGraph(graph);
  if (index.thesis === null) return [];

  const support = buildSupportModel(graph, index);
  const ctx: AnalysisContext<Id> = {
    graph,
    index,
    support,
    cycles: support.cycles,
    thesis: index.thesis,
  };

  return ANALYZERS.flatMap((analyzer) => analyzer.run(ctx) as readonly AnalysisFinding<Id>[]);
}
