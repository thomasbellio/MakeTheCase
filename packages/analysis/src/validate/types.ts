import type { LocalId } from '@make-your-case/domain';

/**
 * One problem found in a draft.
 *
 * `message` is written to be fed back to a model on a validation retry
 * (AGENTS.md section 8.2), so it names the local IDs involved and says what
 * would make it right, rather than merely reporting a rule name.
 */
export interface ValidationIssue {
  readonly rule: string;
  readonly message: string;
  readonly refs: readonly LocalId[];
}

/**
 * Errors block the run and drive a retry; warnings never do.
 *
 * A brief legitimately contains background material that takes no part in the
 * argument, so treating that as an error would make well-formed documents fail
 * (section 7.3).
 */
export type ValidationResult =
  | { readonly ok: true; readonly warnings: readonly ValidationIssue[] }
  | {
      readonly ok: false;
      readonly errors: readonly [ValidationIssue, ...ValidationIssue[]];
      readonly warnings: readonly ValidationIssue[];
    };

export function issue(rule: string, message: string, refs: readonly LocalId[]): ValidationIssue {
  return { rule, message, refs };
}
