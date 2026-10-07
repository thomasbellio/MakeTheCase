import type { ArgumentGraphDraft, LocalId } from '@make-your-case/domain';
import { issue, type ValidationIssue } from '../types.ts';

/**
 * Each inference is a usable step, and no two say the same thing.
 *
 * Duplicate premises are rejected because support evaluation counts how many
 * premises a step is still waiting on; a repeated premise would make that count
 * unreachable and the step could never fire.
 */
export function checkInferences(draft: ArgumentGraphDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const premisesOf = new Map<LocalId, LocalId[]>();
  for (const premise of draft.premises) {
    const existing = premisesOf.get(premise.inference_id);
    if (existing) {
      existing.push(premise.claim_id);
    } else {
      premisesOf.set(premise.inference_id, [premise.claim_id]);
    }
  }

  const originOf = new Map(draft.claims.map((c) => [c.id, c.origin]));
  const routes = new Map<string, LocalId[]>();

  for (const inference of draft.inferences) {
    const premises = premisesOf.get(inference.id) ?? [];

    if (premises.length === 0) {
      issues.push(
        issue(
          'inference-without-premises',
          `Inference ${inference.id} has no premises, so it does not derive its conclusion from anything.`,
          [inference.id],
        ),
      );
      continue;
    }

    const seen = new Set<LocalId>();
    for (const claimId of premises) {
      if (seen.has(claimId)) {
        issues.push(
          issue(
            'duplicate-premise',
            `Inference ${inference.id} lists claim ${claimId} as a premise more than once; list it once.`,
            [inference.id, claimId],
          ),
        );
      }
      seen.add(claimId);
    }

    if (seen.has(inference.conclusion_claim_id)) {
      issues.push(
        issue(
          'conclusion-among-premises',
          `Inference ${inference.id} lists its own conclusion ${inference.conclusion_claim_id} among its premises.`,
          [inference.id, inference.conclusion_claim_id],
        ),
      );
    }

    // Two inferences with the same conclusion and the same premises are the
    // same step written twice, not two alternative routes.
    const key = `${inference.conclusion_claim_id}<=${[...seen].sort().join(',')}`;
    const existing = routes.get(key);
    if (existing) {
      existing.push(inference.id);
      issues.push(
        issue(
          'duplicate-route',
          `Inferences ${existing.join(' and ')} have the same conclusion and the same premises; alternative routes must differ in their premises.`,
          existing,
        ),
      );
    } else {
      routes.set(key, [inference.id]);
    }
  }

  // An inferred premise may join a stated inference, but the premise row's
  // origin describes the claim, so the two must agree.
  for (const premise of draft.premises) {
    const claimOrigin = originOf.get(premise.claim_id);
    if (claimOrigin !== undefined && claimOrigin !== premise.origin) {
      issues.push(
        issue(
          'premise-origin-mismatch',
          `A premise of inference ${premise.inference_id} records origin "${premise.origin}" for claim ${premise.claim_id}, but that claim's origin is "${claimOrigin}".`,
          [premise.inference_id, premise.claim_id],
        ),
      );
    }
  }

  return issues;
}
