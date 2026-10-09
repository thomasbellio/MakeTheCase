import type { KeyResult } from '@make-your-case/answer-keys';
import type { FixtureResult } from './run-fixture.ts';

/**
 * Groups repeated attempts at one fixture.
 *
 * The pipeline is non-deterministic: the same fixture and the same prompts can
 * complete, error, or fail a different check from one run to the next. A single
 * run therefore cannot say whether a prompt change helped, so a fixture is run
 * `--repeat N` times and judged on rates rather than on one outcome.
 */

/** How one check behaved across every attempt. */
export interface CheckStability {
  readonly key: string;
  readonly pass: number;
  readonly fail: number;
  readonly explained: number;
  readonly skipped: number;
  /** Attempts in which this check ran at all. */
  readonly attempts: number;
}

export interface FixtureRuns {
  readonly id: string;
  readonly purpose: string;
  readonly expectedStatus: 'completed' | 'not_an_argument';
  readonly attempts: readonly FixtureResult[];
  /** Attempts whose status matched and whose every check passed or was explained. */
  readonly passed: number;
  readonly errored: number;
  readonly statusMatched: number;
  readonly checks: readonly CheckStability[];
  /** True only when every attempt passed: a gate must not pass on a coin flip. */
  readonly stable: boolean;
}

function tallyChecks(attempts: readonly FixtureResult[]): CheckStability[] {
  const byKey = new Map<
    string,
    { pass: number; fail: number; explained: number; skipped: number }
  >();

  for (const attempt of attempts) {
    for (const row of attempt.hard) {
      const counts = byKey.get(row.key) ?? { pass: 0, fail: 0, explained: 0, skipped: 0 };
      counts[row.status] += 1;
      byKey.set(row.key, counts);
    }
  }

  return [...byKey.entries()].map(([key, counts]) => ({
    key,
    ...counts,
    attempts: counts.pass + counts.fail + counts.explained + counts.skipped,
  }));
}

export function aggregate(attempts: readonly FixtureResult[]): FixtureRuns {
  const [first] = attempts;
  if (first === undefined) throw new Error('a fixture must be attempted at least once');

  const passed = attempts.filter((a) => a.passed).length;

  return {
    id: first.id,
    purpose: first.purpose,
    expectedStatus: first.expectedStatus,
    attempts,
    passed,
    errored: attempts.filter((a) => a.error !== null).length,
    statusMatched: attempts.filter((a) => a.statusMatched).length,
    checks: tallyChecks(attempts),
    stable: passed === attempts.length,
  };
}

/** Checks that did not behave the same way every time — where to look first. */
export function flaky(runs: FixtureRuns): readonly CheckStability[] {
  return runs.checks.filter(
    (check) =>
      check.attempts > 1 &&
      [check.pass, check.fail, check.explained, check.skipped].every((n) => n !== check.attempts),
  );
}

/** The attempt most worth reading: the first failure, else the first attempt. */
export function representative(runs: FixtureRuns): FixtureResult {
  const failing = runs.attempts.find((a) => !a.passed);
  const [first] = runs.attempts;
  if (first === undefined) throw new Error('a fixture must be attempted at least once');
  return failing ?? first;
}

/** Status counts across attempts, e.g. `completed ×3, errored ×2`. */
export function statusBreakdown(runs: FixtureRuns): string {
  const counts = new Map<string, number>();
  for (const attempt of runs.attempts) {
    counts.set(attempt.actualStatus, (counts.get(attempt.actualStatus) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, n]) => (n === 1 ? status : `${status} ×${String(n)}`))
    .join(', ');
}

export type { KeyResult };
