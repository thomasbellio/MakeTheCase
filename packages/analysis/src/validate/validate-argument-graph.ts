import {
  argumentGraphDraftSchema,
  toView,
  type ArgumentGraphDraft,
  type LocalId,
} from '@make-your-case/domain';
import { indexGraph } from '../graph/index-graph.ts';
import { findUnconnectedClaims } from '../graph/connectivity.ts';
import { issue, type ValidationIssue, type ValidationResult } from './types.ts';
import { checkReferences } from './rules/references.ts';
import { checkThesis } from './rules/thesis.ts';
import { checkOccurrences } from './rules/occurrences.ts';
import { checkInferences } from './rules/inferences.ts';
import { checkAttribution } from './rules/attribution.ts';
import { checkRelations } from './rules/relations.ts';
import { checkFormalizations } from './rules/formalizations.ts';

/**
 * Checks that a draft argument graph is structurally sound (AGENTS.md section
 * 7.3).
 *
 * Takes the draft rather than a persisted graph because its whole purpose is to
 * check model output before anything is written, and its messages name local
 * IDs so they can be fed back on a retry.
 *
 * `spanIds` are the spans segmentation produced. They are a separate argument
 * because spans belong to the document, not to the revision, so they are not
 * part of the graph itself — but the occurrence rule cannot be checked without
 * them.
 */
export function validateArgumentGraph(
  draft: ArgumentGraphDraft,
  spanIds: readonly LocalId[],
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Field-level rules (enum values, confidence ranges, non-empty text) are the
  // schema's job; running it here turns a parse failure into the same typed
  // issue list as every other rule rather than an exception.
  const parsed = argumentGraphDraftSchema.safeParse(draft);
  if (!parsed.success) {
    for (const problem of parsed.error.issues) {
      errors.push(issue('schema', `${problem.path.join('.') || '(root)'}: ${problem.message}`, []));
    }
    // Later rules index the graph and would misbehave on malformed data.
    return { ok: false, errors: errors as [ValidationIssue, ...ValidationIssue[]], warnings };
  }

  const spans = new Set(spanIds);

  errors.push(...checkReferences(draft, spans));
  // Everything below indexes the graph, which assumes references resolve.
  if (errors.length > 0) {
    return { ok: false, errors: errors as [ValidationIssue, ...ValidationIssue[]], warnings };
  }

  const view = toView(draft);
  const index = indexGraph(view);

  errors.push(...checkThesis(draft, index));
  errors.push(...checkOccurrences(draft));
  errors.push(...checkInferences(draft));
  errors.push(...checkAttribution(draft, index));
  errors.push(...checkRelations(draft));
  errors.push(...checkFormalizations(draft));

  // Background material that takes no part in the argument is normal in a
  // brief, so this informs rather than blocks.
  for (const claimId of findUnconnectedClaims(view, index)) {
    warnings.push(
      issue(
        'unconnected-claim',
        `Claim ${claimId} takes no part in the argument: it is not a premise, nothing supports it, and nothing attacks or qualifies it.`,
        [claimId],
      ),
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors: errors as [ValidationIssue, ...ValidationIssue[]], warnings };
  }
  return { ok: true, warnings };
}
