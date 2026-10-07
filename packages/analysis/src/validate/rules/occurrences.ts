import type { ArgumentGraphDraft, LocalId } from '@make-your-case/domain';
import { issue, type ValidationIssue } from '../types.ts';

/**
 * Stated claims trace back to the text; inferred claims do not pretend to.
 *
 * This is the structural half of the transparency guarantee in AGENTS.md
 * section 1: no stated claim without an occurrence, and nothing the system
 * inferred presented as something the author wrote.
 */
export function checkOccurrences(draft: ArgumentGraphDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const counts = new Map<LocalId, number>();
  for (const occurrence of draft.occurrences) {
    counts.set(occurrence.claim_id, (counts.get(occurrence.claim_id) ?? 0) + 1);
  }

  for (const claim of draft.claims) {
    const count = counts.get(claim.id) ?? 0;

    if (claim.origin === 'stated' && count === 0) {
      issues.push(
        issue(
          'stated-claim-without-occurrence',
          `Claim ${claim.id} is marked as stated but has no occurrence, so it cannot be traced to the text. Either give it the span it appears in, or mark it inferred.`,
          [claim.id],
        ),
      );
    }

    if (claim.origin === 'inferred' && count > 0) {
      issues.push(
        issue(
          'inferred-claim-with-occurrence',
          `Claim ${claim.id} is marked as inferred but has ${String(count)} occurrence(s). An inferred claim is one the author never stated.`,
          [claim.id],
        ),
      );
    }
  }

  return issues;
}
