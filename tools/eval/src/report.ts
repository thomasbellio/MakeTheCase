import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LlmConfigDescription } from '@make-your-case/domain';
import type { KeyResult } from '@make-your-case/answer-keys';
import type { FixtureResult } from './run-fixture.ts';

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
  };
  readonly models: LlmConfigDescription;
  readonly promptVersions: Readonly<Record<string, string>>;
  readonly totals: {
    readonly fixtures: number;
    readonly passed: number;
    readonly errored: number;
    readonly statusMismatched: number;
    readonly hard: Readonly<Record<KeyResult['status'], number>>;
    readonly soft: Readonly<Record<string, number>>;
  };
  readonly fixtures: readonly FixtureResult[];
}

export function buildReport(args: {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly results: readonly FixtureResult[];
  readonly judge: boolean;
  readonly databaseUrlOverridden: boolean;
  readonly models: LlmConfigDescription;
  readonly promptVersions: Readonly<Record<string, string>>;
}): EvalReport {
  const hard: Record<KeyResult['status'], number> = { pass: 0, fail: 0, skipped: 0, explained: 0 };
  const soft: Record<string, number> = {};

  for (const result of args.results) {
    for (const row of result.hard) hard[row.status] += 1;
    for (const grade of result.soft) soft[grade.grade] = (soft[grade.grade] ?? 0) + 1;
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
    },
    models: args.models,
    promptVersions: args.promptVersions,
    totals: {
      fixtures: args.results.length,
      passed: args.results.filter((r) => r.passed).length,
      errored: args.results.filter((r) => r.error !== null).length,
      statusMismatched: args.results.filter((r) => !r.statusMatched).length,
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

  out.push(`# Eval report — ${report.startedAt}`);
  out.push('');
  out.push(
    `${String(t.fixtures)} fixtures · **${String(t.passed)} passed** · ${String(t.errored)} errored · ` +
      `hard ${String(t.hard.pass)} pass / ${String(t.hard.fail)} fail / ${String(t.hard.explained)} explained / ${String(t.hard.skipped)} skipped`,
  );
  if (report.selection.judge) {
    const soft = Object.entries(report.totals.soft)
      .map(([grade, count]) => `${String(count)} ${grade}`)
      .join(', ');
    out.push('');
    out.push(`Soft grades: ${soft === '' ? 'none' : soft}`);
  } else {
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

  // Failures first: the reason anyone opens this file.
  const failures = report.fixtures.flatMap((fixture) => [
    ...(fixture.statusMatched
      ? []
      : [`| ${fixture.id} | _status_ | ${fixture.expectedStatus} | ${fixture.actualStatus} |`]),
    ...fixture.hard
      .filter((row) => row.status === 'fail')
      .map(
        (row) => `| ${fixture.id} | \`${row.key}\` | pass | ${'reason' in row ? row.reason : ''} |`,
      ),
    ...(fixture.error === null
      ? []
      : [
          `| ${fixture.id} | _errored_ | — | ${fixture.error.name} in ${fixture.error.stage ?? 'setup'}: ${fixture.error.message} |`,
        ]),
  ]);

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
  out.push('| fixture | status | hard | claims | inf | rel | findings | retries | duration |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const f of report.fixtures) {
    const passed = f.hard.filter((r) => r.status !== 'fail').length;
    const c = f.counts;
    out.push(
      `| ${f.id} | ${f.statusMatched ? '✓' : '✗'} ${f.actualStatus} | ${String(passed)}/${String(f.hard.length)} | ` +
        `${c === null ? '—' : String(c.claims)} | ${c === null ? '—' : String(c.inferences)} | ` +
        `${c === null ? '—' : String(c.relations)} | ${c === null ? '—' : String(c.findings)} | ` +
        `${String(f.retries)} | ${seconds(f.durationMs)} |`,
    );
  }
  out.push('');

  for (const f of report.fixtures) {
    out.push('---');
    out.push('');
    out.push(`## ${f.id}`);
    out.push('');
    out.push(f.purpose.trim());
    out.push('');
    out.push(
      `**Status** expected \`${f.expectedStatus}\`, got \`${f.actualStatus}\` ${f.statusMatched ? '✓' : '✗'} · ` +
        `**Retries** ${String(f.retries)} · **Duration** ${seconds(f.durationMs)}`,
    );
    out.push('');

    if (f.error !== null) {
      out.push('### Error');
      out.push('');
      out.push(`\`${f.error.name}\` during \`${f.error.stage ?? 'setup'}\`: ${f.error.message}`);
      out.push('');
      continue;
    }

    if (f.summary !== null) {
      out.push(`**Run summary** ${f.summary}`);
      out.push('');
    }

    out.push('### Hard checks');
    out.push('');
    out.push('| | key | detail |');
    out.push('|---|---|---|');
    for (const row of f.hard) {
      out.push(
        `| ${MARK[row.status]} | \`${row.key}\` | ${'reason' in row ? row.reason : 'as expected'} |`,
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

    if (Object.keys(f.findingsByKind).length > 0) {
      out.push('### Findings by kind');
      out.push('');
      for (const [kind, count] of Object.entries(f.findingsByKind)) {
        out.push(`- ${kind}: ${String(count)}`);
      }
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
