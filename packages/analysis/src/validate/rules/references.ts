import type { ArgumentGraphDraft, LocalId } from '@make-your-case/domain';
import { issue, type ValidationIssue } from '../types.ts';

/**
 * Every local ID is unique within its kind, and every reference resolves.
 *
 * Checked before anything else: the remaining rules index the graph, and an
 * unresolvable reference there would surface as a confusing downstream error
 * rather than the real problem.
 */
export function checkReferences(
  draft: ArgumentGraphDraft,
  spanIds: ReadonlySet<LocalId>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const claimIds = new Set<LocalId>();
  const inferenceIds = new Set<LocalId>();
  const relationIds = new Set<LocalId>();

  const collect = (
    items: readonly { readonly id: LocalId }[],
    into: Set<LocalId>,
    kind: string,
  ): void => {
    for (const item of items) {
      if (into.has(item.id)) {
        issues.push(issue('duplicate-id', `Two ${kind}s share the ID ${item.id}.`, [item.id]));
      }
      into.add(item.id);
    }
  };

  collect(draft.claims, claimIds, 'claim');
  collect(draft.inferences, inferenceIds, 'inference');
  collect(draft.relations, relationIds, 'relation');

  const claim = (id: LocalId, where: string): void => {
    if (!claimIds.has(id)) {
      issues.push(
        issue('dangling-reference', `${where} references claim ${id}, which does not exist.`, [id]),
      );
    }
  };
  const inference = (id: LocalId, where: string): void => {
    if (!inferenceIds.has(id)) {
      issues.push(
        issue('dangling-reference', `${where} references inference ${id}, which does not exist.`, [
          id,
        ]),
      );
    }
  };

  for (const occurrence of draft.occurrences) {
    claim(occurrence.claim_id, 'An occurrence');
    if (!spanIds.has(occurrence.span_id)) {
      issues.push(
        issue(
          'dangling-reference',
          `An occurrence of claim ${occurrence.claim_id} references span ${occurrence.span_id}, which does not exist.`,
          [occurrence.claim_id, occurrence.span_id],
        ),
      );
    }
  }

  for (const inf of draft.inferences) {
    claim(inf.conclusion_claim_id, `Inference ${inf.id}`);
  }
  for (const premise of draft.premises) {
    inference(premise.inference_id, 'A premise');
    claim(premise.claim_id, `A premise of inference ${premise.inference_id}`);
  }
  for (const relation of draft.relations) {
    claim(relation.source_claim_id, `Relation ${relation.id}`);
    if (relation.target_claim_id !== null)
      claim(relation.target_claim_id, `Relation ${relation.id}`);
    if (relation.target_inference_id !== null) {
      inference(relation.target_inference_id, `Relation ${relation.id}`);
    }
  }

  return issues;
}
