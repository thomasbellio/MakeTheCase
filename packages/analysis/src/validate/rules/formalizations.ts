import type { ArgumentGraphDraft, LocalId } from '@make-your-case/domain';
import { collectAtoms } from '../../logic/formula.ts';
import { issue, type ValidationIssue } from '../types.ts';

/**
 * A formalization describes the step it is attached to, and nothing else.
 *
 * One formula per premise, in premise order, and every atom bound to a claim
 * that step actually uses — otherwise an `invalid_step` explanation would cite
 * claims the reader cannot find in the step.
 */
export function checkFormalizations(draft: ArgumentGraphDraft): ValidationIssue[] {
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

  for (const inference of draft.inferences) {
    const formalization = inference.formalization;
    if (formalization === null) continue;

    if (inference.scheme !== 'deductive') {
      issues.push(
        issue(
          'formalization-scheme',
          `Inference ${inference.id} has a formalization but its scheme is "${inference.scheme}"; only deductive steps are formalized.`,
          [inference.id],
        ),
      );
    }

    const premises = premisesOf.get(inference.id) ?? [];
    if (formalization.premises.length !== premises.length) {
      issues.push(
        issue(
          'formalization-arity',
          `Inference ${inference.id} has ${String(premises.length)} premise(s) but ${String(formalization.premises.length)} premise formula(s); there must be one formula per premise, in premise order.`,
          [inference.id],
        ),
      );
    }

    const allowed = new Set<LocalId>([...premises, inference.conclusion_claim_id]);
    for (const [atom, claimId] of Object.entries(formalization.atoms)) {
      if (!allowed.has(claimId)) {
        issues.push(
          issue(
            'formalization-atom',
            `In inference ${inference.id}, atom "${atom}" is bound to claim ${claimId}, which is neither a premise nor the conclusion of that step.`,
            [inference.id, claimId],
          ),
        );
      }
    }

    const bound = new Set(Object.keys(formalization.atoms));
    const used = collectAtoms([...formalization.premises, formalization.conclusion]);
    for (const atom of used) {
      if (!bound.has(atom)) {
        issues.push(
          issue(
            'formalization-atom',
            `In inference ${inference.id}, atom "${atom}" is used in a formula but is not bound to any claim.`,
            [inference.id],
          ),
        );
      }
    }
  }

  return issues;
}
