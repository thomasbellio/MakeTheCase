import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LlmConfigDescription } from '@make-your-case/domain';
import type { KeyResult } from '@make-your-case/answer-keys';
import { flaky, representative, statusBreakdown, type FixtureRuns } from './aggregate.ts';

/**
 * The run's record (AGENTS.md section 8.7): `report.json` for machines,
 * `report.md` for a person deciding whether the pipeline got better.
 */

export interface EvalReport {
  readonly schemaVersion: 1;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly selection: {
    readonly fixtures: readonly string[];
    readonly judge: boolean;
    readonly databaseUrlOverridden: boolean;
    /** Attempts per fixture. Above 1, the run measures rates rather than outcomes. */
    readonly repeat: number;
  };
  readonly models: LlmConfigDescription;
  readonly promptVersions: Readonly<Record<string, string>>;
  readonly totals: {
    readonly fixtures: number;
    /** Fixtures that passed every attempt. */
    readonly stable: number;
    readonly attempts: number;
    readonly attemptsPassed: number;
    readonly errored: number;
    readonly hard: Readonly<Record<KeyResult['status'], number>>;
    readonly soft: Readonly<Record<string, number>>;
  };
  readonly fixtures: readonly FixtureRuns[];
}

export function buildReport(args: {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly results: readonly FixtureRuns[];
  readonly judge: boolean;
  readonly databaseUrlOverridden: boolean;
  readonly repeat: number;
  readonly models: LlmConfigDescription;
  readonly promptVersions: Readonly<Record<string, string>>;
}): EvalReport {
  const hard: Record<KeyResult['status'], number> = { pass: 0, fail: 0, skipped: 0, explained: 0 };
  const soft: Record<string, number> = {};

  for (const runs of args.results) {
    for (const attempt of runs.attempts) {
      for (const row of attempt.hard) hard[row.status] += 1;
      for (const grade of attempt.soft) soft[grade.grade] = (soft[grade.grade] ?? 0) + 1;
    }
  }

  return {
    schemaVersion: 1,
    startedAt: args.startedAt.toISOString(),
    finishedAt: args.finishedAt.toISOString(),
    durationMs: args.finishedAt.getTime() - args.startedAt.getTime(),
    selection: {
      fixtures: args.results.map((r) => r.id),
      judge: args.judge,
      databaseUrlOverridden: args.databaseUrlOverridden,
      repeat: args.repeat,
    },
    models: args.models,
    promptVersions: args.promptVersions,
    totals: {
      fixtures: args.results.length,
      stable: args.results.filter((r) => r.stable).length,
      attempts: args.results.reduce((n, r) => n + r.attempts.length, 0),
      attemptsPassed: args.results.reduce((n, r) => n + r.passed, 0),
      errored: args.results.reduce((n, r) => n + r.errored, 0),
      hard,
      soft,
    },
    fixtures: args.results,
  };
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

const MARK: Readonly<Record<KeyResult['status'], string>> = {
  pass: '✓',
  fail: '✗',
  skipped: '–',
  explained: '≈',
};

export function renderReportMarkdown(report: EvalReport): string {
  const out: string[] = [];
  const t = report.totals;
  const repeated = report.selection.repeat > 1;

  out.push(`# Eval report — ${report.startedAt}`);
  out.push('');
  out.push(
    `${String(t.fixtures)} fixtures × ${String(report.selection.repeat)} attempt(s) · ` +
      `**${String(t.stable)} of ${String(t.fixtures)} passed every attempt** · ` +
      `${String(t.attemptsPassed)} of ${String(t.attempts)} attempts passed · ${String(t.errored)} errored`,
  );
  out.push('');
  out.push(
    `Hard checks across all attempts: ${String(t.hard.pass)} pass / ${String(t.hard.fail)} fail / ` +
      `${String(t.hard.explained)} explained / ${String(t.hard.skipped)} skipped`,
  );
  if (!report.selection.judge) {
    out.push('');
    out.push('The judge did not run (`--no-judge`), so no soft expectation was graded.');
  }
  out.push('');
  out.push(`Total ${seconds(report.durationMs)}, sequential.`);
  out.push('');

  out.push('| stage | provider | model | prompt |');
  out.push('|---|---|---|---|');
  for (const [stage, described] of Object.entries(report.models)) {
    out.push(
      `| ${stage} | ${described.provider} | ${described.model} | \`${report.promptVersions[stage] ?? '—'}\` |`,
    );
  }
  out.push('');

  // Failures first: the reason anyone opens this file. Deduplicated across
  // attempts, since a repeated sweep would otherwise list the same one N times.
  const failures: string[] = [];
  for (const runs of report.fixtures) {
    const reported = new Set<string>();

    for (const attempt of runs.attempts) {
      if (!attempt.statusMatched && !reported.has('_status')) {
        reported.add('_status');
        failures.push(
          `| ${runs.id} | _status_ | ${runs.expectedStatus} | ${attempt.actualStatus} |`,
        );
      }

      for (const row of attempt.hard) {
        if (row.status !== 'fail' || reported.has(row.key)) continue;
        reported.add(row.key);
        failures.push(`| ${runs.id} | \`${row.key}\` | pass | ${row.reason} |`);
      }

      if (attempt.error !== null && !reported.has('_error')) {
        reported.add('_error');
        const where = attempt.error.stage ?? 'setup';
        failures.push(
          `| ${runs.id} | _errored_ | — | ${attempt.error.name} in ${where}: ${attempt.error.message} |`,
        );
      }
    }
  }

  out.push('## Failures');
  out.push('');
  if (failures.length === 0) {
    out.push('None.');
  } else {
    out.push('| fixture | check | expected | observed |');
    out.push('|---|---|---|---|');
    out.push(...failures);
  }
  out.push('');

  out.push('## Summary');
  out.push('');
  out.push(`| fixture | passed | statuses | hard failures | retries |`);
  out.push('|---|---|---|---|---|');
  for (const runs of report.fixtures) {
    const failures = [
      ...new Set(
        runs.attempts.flatMap((a) => a.hard.filter((r) => r.status === 'fail').map((r) => r.key)),
      ),
    ];
    const retries = runs.attempts.map((a) => a.retries);
    out.push(
      `| ${runs.id} | ${runs.stable ? '**' : ''}${String(runs.passed)}/${String(runs.attempts.length)}${runs.stable ? '**' : ''} | ` +
        `${statusBreakdown(runs)} | ${failures.length === 0 ? '—' : failures.map((f) => `\`${f}\``).join(', ')} | ` +
        `${Math.min(...retries) === Math.max(...retries) ? String(retries[0] ?? 0) : `${String(Math.min(...retries))}–${String(Math.max(...retries))}`} |`,
    );
  }
  out.push('');

  // With repeats, the interesting thing is not which checks failed but which
  // ones failed *sometimes* — that is where variance lives.
  if (repeated) {
    const unstable = report.fixtures.flatMap((runs) =>
      flaky(runs).map(
        (check) =>
          `| ${runs.id} | \`${check.key}\` | ${String(check.pass)} | ${String(check.fail)} | ${String(check.attempts)} |`,
      ),
    );
    out.push('## Unstable checks');
    out.push('');
    if (unstable.length === 0) {
      out.push('None: every check behaved the same way on every attempt.');
    } else {
      out.push(
        'These passed on some attempts and failed on others, so a single run cannot judge them.',
      );
      out.push('');
      out.push('| fixture | check | passed | failed | attempts |');
      out.push('|---|---|---|---|---|');
      out.push(...unstable);
    }
    out.push('');
  }

  for (const runs of report.fixtures) {
    const f = representative(runs);
    out.push('---');
    out.push('');
    out.push(`## ${runs.id}`);
    out.push('');
    out.push(runs.purpose.trim());
    out.push('');
    out.push(
      `**Passed** ${String(runs.passed)} of ${String(runs.attempts.length)} attempt(s) · ` +
        `**Statuses** ${statusBreakdown(runs)} · **Expected** \`${runs.expectedStatus}\``,
    );
    out.push('');
    if (repeated) {
      out.push(
        `The detail below is from ${runs.passed === runs.attempts.length ? 'the first attempt' : 'the first failing attempt'}.`,
      );
      out.push('');
    }

    if (f.error !== null) {
      out.push('### Error');
      out.push('');
      out.push(`\`${f.error.name}\` during \`${f.error.stage ?? 'setup'}\`: ${f.error.message}`);
      out.push('');
      if (f.validationErrors.length > 0) {
        out.push('What validation was asking the model to fix:');
        out.push('');
        out.push(...f.validationErrors.map((e) => `- ${e}`));
        out.push('');
      }
      continue;
    }

    if (f.validationErrors.length > 0) {
      out.push('### Outstanding validation errors');
      out.push('');
      out.push(...f.validationErrors.map((e) => `- ${e}`));
      out.push('');
    }

    out.push('### Hard checks');
    out.push('');
    out.push(repeated ? '| | key | passed | detail |' : '| | key | detail |');
    out.push(repeated ? '|---|---|---|---|' : '|---|---|---|');
    for (const row of f.hard) {
      const stability = runs.checks.find((c) => c.key === row.key);
      const rate =
        stability === undefined ? '' : `${String(stability.pass)}/${String(stability.attempts)}`;
      const detail = 'reason' in row ? row.reason : 'as expected';
      out.push(
        repeated
          ? `| ${MARK[row.status]} | \`${row.key}\` | ${rate} | ${detail} |`
          : `| ${MARK[row.status]} | \`${row.key}\` | ${detail} |`,
      );
    }
    out.push('');

    if (f.soft.length > 0) {
      out.push('### Soft grades');
      out.push('');
      for (const grade of f.soft) {
        out.push(`- **\`${grade.path}\`** — ${grade.grade}. ${grade.rationale}`);
      }
      out.push('');
    }

    if (f.counts !== null) {
      const c = f.counts;
      out.push(
        `### Counts\n\nspans ${String(c.spans)} ` +
          `(argumentative: ${String(c.spansConfidentlyArgumentative)} confident of ${String(c.spansLabelledArgumentative)} labelled) · ` +
          `claims ${String(c.claims)} (${String(c.inferredClaims)} inferred, ${String(c.claimsNotAsserted)} hedged) · ` +
          `occurrences ${String(c.occurrences)} · inferences ${String(c.inferences)} · relations ${String(c.relations)}`,
      );
      out.push('');
    }

    if (f.rendering !== null) {
      // Embedded because a soft failure is undebuggable without the exact text
      // the judge was shown.
      out.push('<details><summary>The graph as the judge saw it</summary>');
      out.push('');
      out.push('```');
      out.push(f.rendering);
      out.push('```');
      out.push('');
      out.push('</details>');
      out.push('');
    }
  }

  return out.join('\n');
}

/** Writes both files. JSON first, so a rendering bug still leaves the data. */
export async function writeReport(report: EvalReport, outDir: string): Promise<string> {
  const stamp = report.startedAt.replace(/[:.]/g, '-');
  const dir = path.join(outDir, stamp);
  await mkdir(dir, { recursive: true });

  await writeFile(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dir, 'report.md'), renderReportMarkdown(report), 'utf8');

  return dir;
}
