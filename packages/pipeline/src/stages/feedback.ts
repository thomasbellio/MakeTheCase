import type { ValidationIssue } from '@make-your-case/analysis';

/**
 * Hints appended to validation messages before they go back to reconstruct.
 * The analysis layer's messages describe what is wrong with the graph; these
 * say what a model that produced it most likely did, so the retry fixes the
 * cause rather than the symptom.
 */
const HINTS: Readonly<Record<string, string>> = {
  'formalization-arity':
    'An extra formula usually means the step relies on a rule that is not among its premises. If the author states that rule, add its claim to premise_ids; if not, add it as an inferred claim and add that to premise_ids. Do not put a formula in the formalization for anything that is not a premise.',
  'formalization-atom':
    'Atoms may stand only for the inference’s own premise and conclusion claims. If the step needs another proposition, it is a missing premise: add it to premise_ids (as an inferred claim if the author never states it).',
};

/** The messages a reconstruct retry receives, deduplicated and with hints for known model errors. */
export function retryFeedback(issues: readonly ValidationIssue[]): string[] {
  const messages = issues.map((issue) => {
    const hint = HINTS[issue.rule];
    return hint === undefined ? issue.message : `${issue.message} ${hint}`;
  });
  return [...new Set(messages)];
}
