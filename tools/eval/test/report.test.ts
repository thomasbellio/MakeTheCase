import { describe, expect, it } from 'vitest';
import { buildReport, renderReportMarkdown } from '../src/report.ts';
import type { FixtureResult } from '../src/run-fixture.ts';

function result(over: Partial<FixtureResult> = {}): FixtureResult {
  return {
    id: '01-example',
    purpose: 'A happy path.',
    durationMs: 31_820,
    expectedStatus: 'completed',
    actualStatus: 'completed',
    statusMatched: true,
    hard: [{ key: 'claim_count', status: 'pass' }],
    soft: [{ path: 'key_claims', grade: 'pass', rationale: 'All six appear.' }],
    counts: {
      spans: 21,
      spansLabelledArgumentative: 9,
      spansConfidentlyArgumentative: 9,
      claims: 6,
      inferredClaims: 0,
      claimsNotAsserted: 0,
      occurrences: 7,
      inferences: 1,
      relations: 0,
      findings: 3,
    },
    findingsByKind: { load_bearing: 3 },
    retries: 0,
    stageDurationsMs: { classify: 9120 },
    runId: null,
    revisionId: null,
    summary: null,
    persistence: { key: 'persistence_roundtrip', status: 'pass' },
    rendering: 'THESIS: Something',
    error: null,
    passed: true,
    ...over,
  };
}

const report = (results: readonly FixtureResult[]) =>
  buildReport({
    startedAt: new Date('2026-10-09T12:04:31.000Z'),
    finishedAt: new Date('2026-10-09T12:11:23.000Z'),
    results,
    judge: true,
    databaseUrlOverridden: false,
    models: { classify: { provider: 'anthropic', model: 'a-model' } },
    promptVersions: { classify: 'classify@1' },
  });

describe('buildReport', () => {
  it('totals pass, fail, explained and skipped separately', () => {
    const built = report([
      result(),
      result({
        id: '14-long',
        passed: true,
        hard: [
          { key: 'claim_count', status: 'pass' },
          {
            key: 'relations_present[undercut]',
            status: 'explained',
            reason: 'absent — explained: not modelled yet',
          },
          { key: 'spans_with_function[narrative]', status: 'skipped', reason: 'no spans' },
        ],
      }),
      result({
        id: '09-broken',
        passed: false,
        hard: [{ key: 'claim_count', status: 'fail', reason: '3 is below 5' }],
      }),
    ]);

    expect(built.totals).toMatchObject({
      fixtures: 3,
      passed: 2,
      hard: { pass: 2, fail: 1, explained: 1, skipped: 1 },
      soft: { pass: 3 },
    });
  });

  it('counts an errored fixture', () => {
    const built = report([
      result({
        passed: false,
        actualStatus: 'errored',
        statusMatched: false,
        error: { name: 'Err', message: 'boom', stage: 'extract' },
      }),
    ]);
    expect(built.totals.errored).toBe(1);
    expect(built.totals.statusMismatched).toBe(1);
  });
});

describe('renderReportMarkdown', () => {
  it('reports no failures when there are none', () => {
    const text = renderReportMarkdown(report([result()]));
    expect(text).toContain('## Failures');
    expect(text).toMatch(/## Failures\n\nNone\./);
  });

  it('puts every failure in the failures table, including an error', () => {
    const text = renderReportMarkdown(
      report([
        result({
          passed: false,
          hard: [{ key: 'claim_count', status: 'fail', reason: '3 is below 5' }],
        }),
        result({
          id: '09-broken',
          passed: false,
          actualStatus: 'errored',
          statusMatched: false,
          error: { name: 'StructuredOutputError', message: 'no match', stage: 'reconstruct' },
        }),
      ]),
    );
    expect(text).toContain('3 is below 5');
    expect(text).toContain('StructuredOutputError in reconstruct');
  });

  it('states plainly when the judge did not run', () => {
    const built = buildReport({
      startedAt: new Date(),
      finishedAt: new Date(),
      results: [result({ soft: [] })],
      judge: false,
      databaseUrlOverridden: false,
      models: {},
      promptVersions: {},
    });
    expect(renderReportMarkdown(built)).toContain('The judge did not run');
  });

  it('embeds the rendering the judge saw, so a soft failure is debuggable', () => {
    expect(renderReportMarkdown(report([result()]))).toContain('THESIS: Something');
  });

  it('shows confident and labelled argumentative counts separately', () => {
    const base = result().counts;
    if (base === null) throw new Error('the fixture builder should supply counts');
    const text = renderReportMarkdown(
      report([
        result({
          counts: { ...base, spansLabelledArgumentative: 4, spansConfidentlyArgumentative: 1 },
        }),
      ]),
    );
    // The distinction that decides whether fixture 11 passes.
    expect(text).toContain('1 confident of 4 labelled');
  });
});
