import type { ArgumentGraphView } from '@make-your-case/domain';
import type { GraphIndex } from './index-graph.ts';

/**
 * Claims that take no part in the argument: not a premise, not a conclusion,
 * and neither the source nor the target of any relation.
 *
 * Briefs routinely contain background of this kind — a standard of review,
 * procedural history — so this is a warning during validation and an `info`
 * finding afterwards, never an error (AGENTS.md section 7.3).
 *
 * Both the validation rule and the `unconnected-claim` analyzer call this one
 * function, so the two cannot drift apart.
 */
export function findUnconnectedClaims<Id extends string>(
  graph: ArgumentGraphView<Id>,
  index: GraphIndex<Id>,
): readonly Id[] {
  return graph.claims
    .filter(
      (claim) =>
        !claim.is_thesis &&
        (index.premiseOf.get(claim.id) ?? []).length === 0 &&
        (index.concludedBy.get(claim.id) ?? []).length === 0 &&
        (index.relationsBySource.get(claim.id) ?? []).length === 0 &&
        (index.relationsByTarget.get(claim.id) ?? []).length === 0,
    )
    .map((claim) => claim.id);
}
