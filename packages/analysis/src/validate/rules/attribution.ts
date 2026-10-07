import type { ArgumentGraphDraft, LocalId } from '@make-your-case/domain';
import type { GraphIndex } from '../../graph/index-graph.ts';
import { issue, type ValidationIssue } from '../types.ts';

/**
 * Nobody's reasoning gets mixed with anybody else's.
 *
 * An inference belongs to one party and uses only that party's claims, so the
 * opponent's position can never end up supporting the author's thesis
 * (AGENTS.md section 1). Anything the system inferred is the author's.
 */
export function checkAttribution(
  draft: ArgumentGraphDraft,
  index: GraphIndex<LocalId>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const attributionOf = new Map<LocalId, string>(draft.claims.map((c) => [c.id, c.attribution]));

  for (const claim of draft.claims) {
    if (claim.origin === 'inferred' && claim.attribution !== 'author') {
      issues.push(
        issue(
          'inferred-attribution',
          `Claim ${claim.id} is inferred but attributed to "${claim.attribution}"; inferred content is the system's reconstruction of the author's reasoning.`,
          [claim.id],
        ),
      );
    }
  }

  for (const inference of draft.inferences) {
    if (inference.origin === 'inferred' && inference.attribution !== 'author') {
      issues.push(
        issue(
          'inferred-attribution',
          `Inference ${inference.id} is inferred but attributed to "${inference.attribution}".`,
          [inference.id],
        ),
      );
    }

    const conclusion = attributionOf.get(inference.conclusion_claim_id);
    if (conclusion !== undefined && conclusion !== inference.attribution) {
      issues.push(
        issue(
          'inference-attribution-mismatch',
          `Inference ${inference.id} is attributed to "${inference.attribution}" but concludes claim ${inference.conclusion_claim_id}, which is attributed to "${conclusion}".`,
          [inference.id, inference.conclusion_claim_id],
        ),
      );
    }

    for (const premiseId of index.premisesOf.get(inference.id) ?? []) {
      const premise = attributionOf.get(premiseId);
      if (premise !== undefined && premise !== inference.attribution) {
        issues.push(
          issue(
            'inference-attribution-mismatch',
            `Inference ${inference.id} is attributed to "${inference.attribution}" but uses claim ${premiseId}, which is attributed to "${premise}".`,
            [inference.id, premiseId],
          ),
        );
      }
    }
  }

  return issues;
}
