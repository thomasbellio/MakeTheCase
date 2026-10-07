import type { ArgumentGraphDraft, LocalId } from '@make-your-case/domain';
import { issue, type ValidationIssue } from '../types.ts';

/**
 * Each relation points at exactly one thing, and attacks cross party lines.
 *
 * An attack on one's own claim is almost always a modelling mistake — the one
 * exception is `qualify`, which is how an author narrows their own claim. When
 * the target is an inference, the attribution compared is that inference's.
 */
export function checkRelations(draft: ArgumentGraphDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const claimAttribution = new Map<LocalId, string>(draft.claims.map((c) => [c.id, c.attribution]));
  const inferenceAttribution = new Map<LocalId, string>(
    draft.inferences.map((i) => [i.id, i.attribution]),
  );

  for (const relation of draft.relations) {
    const hasClaim = relation.target_claim_id !== null;
    const hasInference = relation.target_inference_id !== null;

    if (hasClaim === hasInference) {
      issues.push(
        issue(
          'relation-target',
          hasClaim
            ? `Relation ${relation.id} targets both a claim and an inference; it must target exactly one.`
            : `Relation ${relation.id} targets neither a claim nor an inference; it must target exactly one.`,
          [relation.id],
        ),
      );
      continue;
    }

    if (relation.type === 'qualify') continue;

    const source = claimAttribution.get(relation.source_claim_id);
    const target =
      relation.target_claim_id !== null
        ? claimAttribution.get(relation.target_claim_id)
        : relation.target_inference_id !== null
          ? inferenceAttribution.get(relation.target_inference_id)
          : undefined;

    if (source !== undefined && target !== undefined && source === target) {
      issues.push(
        issue(
          'relation-attribution',
          `Relation ${relation.id} is a "${relation.type}" from and to material attributed to "${source}". An attack normally crosses parties; use "qualify" to narrow one's own claim.`,
          [relation.id],
        ),
      );
    }
  }

  return issues;
}
