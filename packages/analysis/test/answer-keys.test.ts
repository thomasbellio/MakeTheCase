import { describe, expect, it } from 'vitest';
import { toView } from '@make-your-case/domain';
import { loadAnswerKey, scoreHardChecks, type KeyResult } from '@make-your-case/answer-keys';
import { analyzeArgumentGraph } from '../src/analyze/analyze-argument-graph.ts';
import { KEYED_FIXTURES } from './fixtures/index.ts';

/**
 * Checks each hand-built fixture against the real answer key it mirrors
 * (AGENTS.md section 7.5), using the same scorer `pnpm eval` runs.
 *
 * Sharing the scorer is the point: two implementations of the hard keys would
 * drift, which is the failure this cross-check exists to prevent. The
 * discourse-function keys come back `skipped` because a hand-built graph has no
 * spans — asserting a classification property from hand-typed data would prove
 * nothing, and `pnpm eval` covers it against the real pipeline.
 */
const fixtures = await Promise.all(
  KEYED_FIXTURES.map(async (fixture) => {
    const stem = fixture.key ?? '?';
    return {
      stem,
      results: scoreHardChecks((await loadAnswerKey(stem)).key, {
        outcome: 'completed',
        graph: toView(fixture.graph),
        findings: analyzeArgumentGraph(toView(fixture.graph)),
        // No spans: this is a hand-built graph, not a segmented document.
        spans: null,
      }),
    };
  }),
);

const failures = (results: readonly KeyResult[]): string[] =>
  results.flatMap((r) => (r.status === 'fail' ? [`${r.key}: ${r.reason}`] : []));

describe.each(fixtures.map((f) => [f.stem, f] as const))('answer key %s', (_stem, fixture) => {
  it('passes every hard check the key states', () => {
    expect(failures(fixture.results)).toEqual([]);
  });

  it('skips only the keys that need spans', () => {
    const skipped = fixture.results.filter((r) => r.status === 'skipped').map((r) => r.key);
    expect(
      skipped.every(
        (key) =>
          key.startsWith('spans_with_function') || key.startsWith('claim_occurrences_in_function'),
      ),
    ).toBe(true);
  });

  it('actually checked something', () => {
    // Guards against a key whose expectations all silently skip.
    expect(fixture.results.some((r) => r.status === 'pass')).toBe(true);
  });
});

describe('the fixture set as a whole', () => {
  it('covers the fixtures section 7.5 names', () => {
    expect(fixtures.map((f) => f.stem.slice(0, 2))).toEqual([
      '01',
      '02',
      '04',
      '05',
      '06',
      '07',
      '08',
      '14',
    ]);
  });
});
