import type { ArgumentGraphView } from '@make-your-case/domain';
import type { GraphIndex } from './index-graph.ts';
import { findSupportCycles, type SupportCycle } from './cycles.ts';

/**
 * How well-supported each author claim is, and which claims the thesis cannot
 * do without.
 *
 * Computed once and shared by every analyzer through the analysis context, so
 * no analyzer has to recover another's conclusions from its output and none of
 * them can disagree.
 */
export interface SupportModel<Id extends string> {
  readonly authorClaimIds: ReadonlySet<Id>;
  readonly authorInferenceIds: ReadonlySet<Id>;
  /** Author claims no author inference concludes; the argument's starting points. */
  readonly groundClaimIds: ReadonlySet<Id>;
  /** Supported from the ground up, with nothing assumed. */
  readonly derivable: ReadonlySet<Id>;
  readonly thesisGrounded: boolean;
  /** Grounds plus cycle members treated as given; the baseline for removal tests. */
  readonly seedClaimIds: ReadonlySet<Id>;
  readonly baseSupported: ReadonlySet<Id>;
  readonly thesisSupported: boolean;
  readonly loadBearingClaimIds: ReadonlySet<Id>;
  readonly cycles: readonly SupportCycle<Id>[];
}

/**
 * Which claims follow from the seeds.
 *
 * An inference holds when **all** its premises are supported (they are jointly
 * required); a claim is supported when **any** inference concluding it holds
 * (alternative routes). That is Horn-clause derivability, computed as a least
 * fixed point with a worklist: each claim is visited at most once, so this
 * terminates on a circular graph where the obvious recursive formulation would
 * not.
 *
 * Taking the *least* fixed point is the substantive choice. A greatest fixed
 * point would call a self-supporting cycle supported — it is internally
 * consistent, after all — which is exactly the move an argument is not entitled
 * to make.
 */
function derive<Id extends string>(
  index: GraphIndex<Id>,
  inferenceIds: ReadonlySet<Id>,
  seeds: ReadonlySet<Id>,
  removed: Id | null,
): ReadonlySet<Id> {
  const supported = new Set<Id>();
  const waitingOn = new Map<Id, number>();
  for (const inferenceId of inferenceIds) {
    waitingOn.set(inferenceId, (index.premisesOf.get(inferenceId) ?? []).length);
  }

  const queue: Id[] = [...seeds].filter((id) => id !== removed);

  for (let claimId = queue.shift(); claimId !== undefined; claimId = queue.shift()) {
    if (supported.has(claimId)) continue;
    supported.add(claimId);

    for (const inferenceId of index.premiseOf.get(claimId) ?? []) {
      if (!inferenceIds.has(inferenceId)) continue;

      const remaining = (waitingOn.get(inferenceId) ?? 0) - 1;
      waitingOn.set(inferenceId, remaining);
      if (remaining !== 0) continue;

      const conclusion = index.inferenceById.get(inferenceId)?.conclusion_claim_id;
      if (conclusion !== undefined && conclusion !== removed && !supported.has(conclusion)) {
        queue.push(conclusion);
      }
    }
  }

  return supported;
}

export function buildSupportModel<Id extends string>(
  graph: ArgumentGraphView<Id>,
  index: GraphIndex<Id>,
): SupportModel<Id> {
  // The author graph. Opposing and third-party material never supports the
  // author's thesis (AGENTS.md section 6); all inferred content is the
  // author's. Relations are ignored entirely — attacks do not affect support
  // in v1 — which is what keeps an opponent's claims from contributing here.
  const authorClaimIds = new Set(
    graph.claims.filter((c) => c.attribution === 'author').map((c) => c.id),
  );
  const authorInferenceIds = new Set(
    graph.inferences
      .filter(
        (i) =>
          i.attribution === 'author' &&
          authorClaimIds.has(i.conclusion_claim_id) &&
          i.premises.every((p) => authorClaimIds.has(p.claim_id)),
      )
      .map((i) => i.id),
  );

  const groundClaimIds = new Set(
    [...authorClaimIds].filter((id) =>
      (index.concludedBy.get(id) ?? []).every(
        (inferenceId) => !authorInferenceIds.has(inferenceId),
      ),
    ),
  );

  const derivable = derive(index, authorInferenceIds, groundClaimIds, null);
  const thesisId = index.thesis?.id;
  const thesisGrounded = thesisId !== undefined && derivable.has(thesisId);

  const cycles = findSupportCycles(
    authorClaimIds,
    authorInferenceIds,
    index,
    graph.claims.map((c) => c.id),
  );

  // On a circular argument nothing grounds the thesis, which would make
  // "removing this leaves the thesis unsupported" vacuously true of every
  // claim. Seeding the cycle's own members as given restores a meaningful
  // baseline, so the removal test reports the claim the rest of the argument
  // actually leans on. On an acyclic graph there are no cycles and this is a
  // no-op (a least fixed point from the grounds already reaches everything).
  const seedClaimIds = new Set(groundClaimIds);
  for (const cycle of cycles) {
    for (const claimId of cycle.claimIds) {
      if (!derivable.has(claimId)) {
        seedClaimIds.add(claimId);
      }
    }
  }

  const baseSupported = derive(index, authorInferenceIds, seedClaimIds, null);
  const thesisSupported = thesisId !== undefined && baseSupported.has(thesisId);

  // Brute-force per-claim removal. Graphs are small (tens of claims), and
  // AGENTS.md section 7.3 explicitly permits it.
  const loadBearingClaimIds = new Set<Id>();
  if (thesisSupported) {
    for (const claimId of authorClaimIds) {
      if (claimId === thesisId) continue;
      if (!derive(index, authorInferenceIds, seedClaimIds, claimId).has(thesisId)) {
        loadBearingClaimIds.add(claimId);
      }
    }
  }

  return {
    authorClaimIds,
    authorInferenceIds,
    groundClaimIds,
    derivable,
    thesisGrounded,
    seedClaimIds,
    baseSupported,
    thesisSupported,
    loadBearingClaimIds,
    cycles,
  };
}
