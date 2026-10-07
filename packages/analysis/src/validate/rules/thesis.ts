import type { ArgumentGraphDraft, LocalId } from '@make-your-case/domain';
import type { GraphIndex } from '../../graph/index-graph.ts';
import { issue, type ValidationIssue } from '../types.ts';

/**
 * Exactly one thesis, attributed to the author, and actually argued for.
 *
 * A single-claim graph is a degenerate argument: allowed, but reported as an
 * error would be wrong, so it passes here and surfaces as an unsupported
 * starting point in analysis instead.
 */
export function checkThesis(
  draft: ArgumentGraphDraft,
  index: GraphIndex<LocalId>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const theses = draft.claims.filter((c) => c.is_thesis);

  if (theses.length === 0) {
    issues.push(
      issue('thesis-count', 'No claim is marked as the thesis; exactly one must be.', []),
    );
    return issues;
  }
  if (theses.length > 1) {
    issues.push(
      issue(
        'thesis-count',
        `${String(theses.length)} claims are marked as the thesis; exactly one must be.`,
        theses.map((c) => c.id),
      ),
    );
  }

  for (const thesis of theses) {
    if (thesis.attribution !== 'author') {
      issues.push(
        issue(
          'thesis-attribution',
          `The thesis ${thesis.id} is attributed to "${thesis.attribution}"; the thesis is the author's own conclusion.`,
          [thesis.id],
        ),
      );
    }

    const supported = (index.concludedBy.get(thesis.id) ?? []).length > 0;
    if (!supported && draft.claims.length > 1) {
      issues.push(
        issue(
          'thesis-unreachable',
          `No inference concludes the thesis ${thesis.id}, so nothing in the graph argues for it.`,
          [thesis.id],
        ),
      );
    }
  }

  return issues;
}
