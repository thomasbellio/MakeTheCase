import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PROMPT_VERSIONS } from '@make-your-case/pipeline';
import { loadAnswerKey, loadAnswerKeys, resolveFixtureStem } from '@make-your-case/answer-keys';
import { ConfigurationError, createHarness } from './compose.ts';
import { runFixture, type FixtureResult } from './run-fixture.ts';
import { aggregate, type FixtureRuns } from './aggregate.ts';
import { buildReport, writeReport } from './report.ts';
import { judgePrompt } from './judge/judge.v1.ts';

/**
 * `pnpm eval` (AGENTS.md section 8.7).
 *
 * Runs the real pipeline over the fixtures, scores the hard checks
 * deterministically, grades the soft expectations with a judge model, and
 * writes a report. Billed, and never part of the default test suite.
 *
 * Exit codes: 0 all selected fixtures passed, 1 a fixture failed or errored,
 * 2 a usage or configuration problem — so it can gate a pipeline later without
 * confusing "the eval is broken" with "the pipeline got worse".
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      fixture: { type: 'string', multiple: true },
      'no-judge': { type: 'boolean', default: false },
      'database-url': { type: 'string' },
      out: { type: 'string', default: 'eval-results' },
      repeat: { type: 'string', default: '1' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(
      [
        'Usage: pnpm eval [options]',
        '',
        '  --fixture <NN>       run only this fixture; repeatable (e.g. --fixture 05)',
        '  --no-judge           score the hard checks only; makes no judge calls',
        '  --database-url <url> run against a different database',
        '  --out <dir>          where to write the report (default: eval-results)',
        '  --repeat <n>         attempt each fixture n times and report pass rates;',
        '                       the pipeline is non-deterministic, so one run cannot',
        '                       tell an improvement from variance',
        '',
      ].join('\n'),
    );
    return 0;
  }

  const judge = !values['no-judge'];

  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) {
    process.stderr.write(`--repeat must be a positive whole number, got "${values.repeat}"\n`);
    return 2;
  }

  let harness;
  try {
    harness = createHarness({ databaseUrl: values['database-url'], judge });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }

  try {
    try {
      await harness.assertSchemaReady();
    } catch (error) {
      if (error instanceof ConfigurationError) {
        process.stderr.write(`${error.message}\n`);
        return 2;
      }
      throw error;
    }

    const selectors = values.fixture ?? [];
    let fixtures;
    try {
      fixtures =
        selectors.length === 0
          ? await loadAnswerKeys()
          : await Promise.all(
              (await Promise.all(selectors.map(async (s) => resolveFixtureStem(s)))).map(
                async (stem) => loadAnswerKey(stem),
              ),
            );
    } catch (error) {
      // A mistyped selector or a malformed answer key is a usage problem, not a
      // crash: say what went wrong and list what is available.
      process.stderr.write(`${(error as Error).message}\n`);
      const available = await loadAnswerKeys().catch(() => []);
      if (available.length > 0) {
        process.stderr.write(
          `\nAvailable fixtures:\n${available.map((f) => `  ${f.stem}`).join('\n')}\n`,
        );
      }
      return 2;
    }

    process.stderr.write(
      `Evaluating ${String(fixtures.length)} fixture(s)${judge ? '' : ' without the judge'}.\n`,
    );

    const startedAt = new Date();
    const results: FixtureRuns[] = [];

    // Sequential: 14 fixtures against one provider is around a hundred calls,
    // and concurrency turns a rate limit into perturbed results. Section 2 puts
    // latency optimization out of scope.
    for (const fixture of fixtures) {
      const attempts: FixtureResult[] = [];
      for (let attempt = 1; attempt <= repeat; attempt += 1) {
        process.stderr.write(
          `\n${fixture.stem}${repeat > 1 ? ` (${String(attempt)}/${String(repeat)})` : ''}\n`,
        );
        const result = await runFixture(fixture, harness, { judge });
        attempts.push(result);
        process.stderr.write(
          `  ${result.passed ? 'PASS' : 'FAIL'} ${result.actualStatus}` +
            `${result.error === null ? '' : ` (${result.error.name})`}\n`,
        );
      }
      const runs = aggregate(attempts);
      results.push(runs);
      if (repeat > 1) {
        process.stderr.write(
          `  ${fixture.stem}: ${String(runs.passed)}/${String(repeat)} attempts passed\n`,
        );
      }
    }

    const report = buildReport({
      startedAt,
      finishedAt: new Date(),
      results,
      judge,
      databaseUrlOverridden: values['database-url'] !== undefined,
      repeat,
      models: harness.models.describe(),
      promptVersions: {
        ...PROMPT_VERSIONS,
        judge: `${judgePrompt.id}@${String(judgePrompt.version)}`,
      },
    });

    // Relative to the repository root, so the output lands in one place
    // regardless of where the CLI was invoked from.
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const dir = await writeReport(report, path.resolve(repoRoot, values.out));
    process.stdout.write(`\n${dir}/report.md\n`);

    const { stable, fixtures: total, attempts, attemptsPassed, errored } = report.totals;
    process.stderr.write(
      `\n${String(stable)} of ${String(total)} fixtures passed every attempt ` +
        `(${String(attemptsPassed)}/${String(attempts)} attempts)` +
        `${errored === 0 ? '' : `, ${String(errored)} errored`}.\n`,
    );

    // A gate must not pass on a coin flip: every attempt has to pass.
    return stable === total ? 0 : 1;
  } finally {
    await harness.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exit(1);
  });
