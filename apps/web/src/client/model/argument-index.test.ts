import { describe, expect, it } from 'vitest';
import { sampleArgument } from '../testing/sample-argument.ts';
import { indexArgument } from './argument-index.ts';

describe('indexArgument', () => {
  it('orders claims by where they first appear, inferred claims beside what they support', () => {
    const { graph, spans, ids } = sampleArgument();
    const index = indexArgument(graph, spans);

    expect(index.claims.map((claim) => claim.id)).toEqual([
      ids.background,
      ids.rule,
      ids.fact,
      ids.objection,
      ids.thesis,
      // Inferred, so it has no position of its own: it follows the thesis it supports.
      ids.bridge,
    ]);
  });

  it('gives the same order however the rows arrive', () => {
    const sample = sampleArgument();
    const reversed = {
      ...sample.graph,
      claims: [...sample.graph.claims].reverse(),
      premises: [...sample.graph.premises].reverse(),
      findings: [...sample.graph.findings].reverse(),
    };

    const a = indexArgument(sample.graph, sample.spans);
    const b = indexArgument(reversed, [...sample.spans].reverse());

    expect(b.claims).toEqual(a.claims);
    expect(b.premisesOf).toEqual(a.premisesOf);
    expect(b.findings).toEqual(a.findings);
    expect(b.spans).toEqual(a.spans);
  });

  it('orders premises in reading order', () => {
    const { graph, spans, ids } = sampleArgument();
    expect(indexArgument(graph, spans).premisesOf.get(ids.step)).toEqual([
      ids.rule,
      ids.fact,
      ids.bridge,
    ]);
  });

  it('orders findings most severe first', () => {
    const { graph, spans } = sampleArgument();
    expect(indexArgument(graph, spans).findings.map((f) => f.severity)).toEqual([
      'critical',
      'warning',
      'info',
      'info',
      'info',
      'info',
      'info',
    ]);
  });

  it('reads load-bearing and uncited claims from the findings', () => {
    const { graph, spans, ids } = sampleArgument();
    const index = indexArgument(graph, spans);

    expect([...index.loadBearing].sort()).toEqual([ids.rule, ids.fact, ids.bridge].sort());
    expect([...index.uncited]).toEqual([ids.fact]);
    expect(index.criticalCount.get(ids.bridge)).toBe(1);
    expect(index.criticalCount.get(ids.fact)).toBeUndefined();
  });

  it('links spans and claims both ways', () => {
    const { graph, spans, ids } = sampleArgument();
    const index = indexArgument(graph, spans);

    expect(index.claimsInSpan.get(ids.spans[3] ?? never())).toEqual([ids.fact]);
    expect(index.occurrencesOf.get(ids.fact)?.map((o) => o.span_id)).toEqual([ids.spans[3]]);
    expect(index.occurrencesOf.get(ids.bridge)).toBeUndefined();
  });

  it('finds the thesis and the inferences concluding a claim', () => {
    const { graph, spans, ids } = sampleArgument();
    const index = indexArgument(graph, spans);

    expect(index.thesis?.id).toBe(ids.thesis);
    expect(index.inferencesConcluding.get(ids.thesis)).toEqual([ids.step]);
    expect(index.findingsOfInference.get(ids.step)?.map((f) => f.kind)).toEqual(['unchecked_step']);
  });
});

function never(): never {
  throw new Error('fixture is missing a span');
}
