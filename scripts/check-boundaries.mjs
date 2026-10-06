/**
 * Asserts that the ESLint import-boundary rules actually reject the
 * architecture violations described in AGENTS.md section 4.
 *
 * Lint configuration that is never exercised rots silently, so each fixture
 * contains one deliberately illegal import and this script requires ESLint to
 * flag it. A fixture must live inside the package whose rule it tests, because
 * eslint-plugin-boundaries derives an element's type from its file path.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const RULE = 'boundaries/dependencies';

const EXPECTED = [
  {
    fixture: 'packages/pipeline/src/__boundaries__/imports-persistence.boundary-fixture.ts',
    why: 'pipeline must not import persistence; repositories are injected',
  },
  {
    fixture: 'packages/domain/src/__boundaries__/imports-drizzle.boundary-fixture.ts',
    why: 'domain depends on zod only',
  },
  {
    fixture: 'packages/analysis/src/__boundaries__/imports-app.boundary-fixture.ts',
    why: 'no package may import from an apps/* package',
  },
  {
    fixture: 'apps/web/src/client/__boundaries__/imports-persistence.boundary-fixture.ts',
    why: 'web client code may import domain types only',
  },
];

let failures = 0;

for (const { fixture, why } of EXPECTED) {
  let output;
  try {
    const { stdout } = await run('pnpm', [
      'exec',
      'eslint',
      '--no-config-lookup',
      '-c',
      'eslint.boundaries.config.js',
      '--no-warn-ignored',
      '--format',
      'json',
      fixture,
    ]);
    output = stdout;
  } catch (error) {
    // ESLint exits non-zero when it reports errors, which is the expected path.
    output = error.stdout ?? '';
  }

  let messages;
  try {
    messages = JSON.parse(output).flatMap((result) => result.messages);
  } catch {
    console.error(`FAIL  ${fixture}\n      could not parse ESLint output`);
    failures += 1;
    continue;
  }

  const hit = messages.find((message) => message.ruleId === RULE);
  if (hit) {
    console.log(`ok    ${why}\n      ${fixture}`);
  } else {
    const seen = [...new Set(messages.map((m) => m.ruleId))].join(', ') || '(no errors at all)';
    console.error(`FAIL  ${why}\n      ${fixture}\n      expected ${RULE}, got: ${seen}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${EXPECTED.length} boundary rules did not fire as expected.`);
  process.exit(1);
}
console.log(`\nAll ${EXPECTED.length} boundary rules fired as expected.`);
