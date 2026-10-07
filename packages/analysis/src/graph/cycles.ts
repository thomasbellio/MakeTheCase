import { DirectedGraph } from 'graphology';
import { stronglyConnectedComponents } from 'graphology-components';
import type { FindingTarget } from '@make-your-case/domain';
import type { GraphIndex } from './index-graph.ts';

/** One circular chain of support, with its members in traversal order. */
export interface SupportCycle<Id extends string> {
  readonly claimIds: readonly Id[];
  readonly inferenceIds: readonly Id[];
  /** Claim, inference, claim, ... round the loop — the order a finding reports. */
  readonly ordered: readonly FindingTarget<Id>[];
}

const CLAIM = 'c:';
const INFERENCE = 'i:';

/**
 * Finds circular support among the given claims and inferences.
 *
 * Runs over the bipartite digraph AGENTS.md section 7.3 specifies — premise
 * claim -> inference, inference -> conclusion claim — which is why a cycle's
 * members include inferences as well as claims.
 *
 * Reports one cycle per non-trivial strongly-connected component rather than
 * per simple cycle: enumerating simple cycles is exponential, and several of
 * them describe the same loop, which would mean several findings about one
 * problem.
 */
export function findSupportCycles<Id extends string>(
  claimIds: ReadonlySet<Id>,
  inferenceIds: ReadonlySet<Id>,
  index: GraphIndex<Id>,
  /** Claim order from the source graph, so output is deterministic. */
  claimOrder: readonly Id[],
): readonly SupportCycle<Id>[] {
  const graph = new DirectedGraph();

  for (const claimId of claimIds) {
    graph.mergeNode(CLAIM + claimId);
  }
  for (const inferenceId of inferenceIds) {
    graph.mergeNode(INFERENCE + inferenceId);
    const inference = index.inferenceById.get(inferenceId);
    if (inference === undefined) continue;

    for (const premiseId of index.premisesOf.get(inferenceId) ?? []) {
      if (claimIds.has(premiseId)) {
        graph.mergeDirectedEdge(CLAIM + premiseId, INFERENCE + inferenceId);
      }
    }
    if (claimIds.has(inference.conclusion_claim_id)) {
      graph.mergeDirectedEdge(INFERENCE + inferenceId, CLAIM + inference.conclusion_claim_id);
    }
  }

  const rank = new Map<Id, number>(claimOrder.map((id, i) => [id, i]));
  const cycles: SupportCycle<Id>[] = [];

  for (const component of stronglyConnectedComponents(graph)) {
    // A single node with no self-loop is not a cycle. Validation forbids an
    // inference concluding one of its own premises, so self-loops should not
    // arise, but a one-node component is checked rather than assumed.
    if (component.length < 2) continue;

    const members = new Set(component);
    const componentClaims = component
      .filter((n) => n.startsWith(CLAIM))
      .map((n) => n.slice(CLAIM.length) as Id);

    // Walk the loop from its lowest-ranked claim so the reported order is
    // stable and reads as a chain rather than an arbitrary set.
    const start = componentClaims.reduce((lowest, id) =>
      (rank.get(id) ?? Infinity) < (rank.get(lowest) ?? Infinity) ? id : lowest,
    );

    const ordered: FindingTarget<Id>[] = [];
    const claimIdsOrdered: Id[] = [];
    const inferenceIdsOrdered: Id[] = [];
    const visited = new Set<string>();

    let node = CLAIM + start;
    while (!visited.has(node)) {
      visited.add(node);
      const ordinal = ordered.length;
      if (node.startsWith(CLAIM)) {
        const id = node.slice(CLAIM.length) as Id;
        claimIdsOrdered.push(id);
        ordered.push({ target: 'claim', claim_id: id, ordinal });
      } else {
        const id = node.slice(INFERENCE.length) as Id;
        inferenceIdsOrdered.push(id);
        ordered.push({ target: 'inference', inference_id: id, ordinal });
      }

      const next = graph
        .outNeighbors(node)
        .filter((n) => members.has(n) && !visited.has(n))
        .sort()[0];
      if (next === undefined) break;
      node = next;
    }

    cycles.push({
      claimIds: claimIdsOrdered,
      inferenceIds: inferenceIdsOrdered,
      ordered,
    });
  }

  return cycles;
}
