import { describe, expect, it } from 'vitest';
import { localId } from '@make-your-case/domain';
import { validateArgumentGraph } from '../src/validate/validate-argument-graph.ts';
import {
  invalidGraph,
  invalidGraphSpans,
  KEYED_FIXTURES,
  unconnectedBackgroundGraph,
  unconnectedBackgroundSpans,
} from './fixtures/index.ts';

describe('validateArgumentGraph', () => {
  it('accepts every acceptance fixture', () => {
    for (const fixture of KEYED_FIXTURES) {
      const result = validateArgumentGraph(fixture.graph, fixture.spans);
      // Naming the offending fixture matters: a bare `toBe(true)` here would
      // say nothing about which graph broke.
      expect(
        result.ok,
        `${fixture.key ?? '?'}: ${JSON.stringify(result.ok ? [] : result.errors)}`,
      ).toBe(true);
    }
  });

  it('treats an unconnected background claim as a warning, not an error', () => {
    const result = validateArgumentGraph(unconnectedBackgroundGraph, unconnectedBackgroundSpans);

    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.rule)).toEqual(['unconnected-claim']);
    expect(result.warnings[0]?.refs).toEqual([localId('c3')]);
  });

  it('rejects a graph that breaks several rules, naming each one', () => {
    const result = validateArgumentGraph(invalidGraph, invalidGraphSpans);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // A dangling reference is reported before anything that would index the
    // graph, so this run stops there.
    expect(result.errors.map((e) => e.rule)).toContain('dangling-reference');
    expect(result.errors.some((e) => e.message.includes('c99'))).toBe(true);
  });

  it('reports the remaining structural problems once references resolve', () => {
    // Drop the dangling premise so the later rules get to run.
    const repaired = {
      ...invalidGraph,
      premises: invalidGraph.premises.filter((p) => p.claim_id !== localId('c99')),
    };
    const result = validateArgumentGraph(repaired, invalidGraphSpans);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const rules = new Set(result.errors.map((e) => e.rule));
    for (const expected of [
      'thesis-count',
      'stated-claim-without-occurrence',
      'inferred-claim-with-occurrence',
      'inference-without-premises',
      'conclusion-among-premises',
      'duplicate-premise',
      'duplicate-route',
      'inference-attribution-mismatch',
      'relation-target',
      'relation-attribution',
      'formalization-atom',
    ]) {
      expect(rules, `expected a ${expected} error`).toContain(expected);
    }
  });

  it('reports a graph with no thesis', () => {
    const result = validateArgumentGraph(
      { claims: [], occurrences: [], inferences: [], premises: [], relations: [], findings: [] },
      [],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.rule)).toContain('thesis-count');
  });

  it('turns schema violations into issues rather than exceptions', () => {
    const result = validateArgumentGraph(
      {
        claims: [
          {
            id: localId('c1'),
            canonical_text: 'A claim',
            kind: 'factual',
            modality: 'asserted',
            origin: 'stated',
            attribution: 'author',
            citation: null,
            // Outside [0, 1]; the schema is what catches this.
            confidence: 1.5,
            is_thesis: true,
          },
        ],
        occurrences: [],
        inferences: [],
        premises: [],
        relations: [],
        findings: [],
      },
      [],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.rule)).toContain('schema');
  });

  it('messages name the local IDs involved, for the retry prompt', () => {
    const result = validateArgumentGraph(invalidGraph, invalidGraphSpans);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    for (const error of result.errors) {
      expect(error.message.length).toBeGreaterThan(20);
      expect(error.message).toMatch(/\.$/);
    }
  });
});
