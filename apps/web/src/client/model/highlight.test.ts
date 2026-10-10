import { describe, expect, it } from 'vitest';
import type { SpanId } from '@make-your-case/domain';
import { sampleArgument } from '../testing/sample-argument.ts';
import { indexArgument } from './argument-index.ts';
import { firstSpan, highlightFor, sameSelection } from './highlight.ts';

function setup() {
  const sample = sampleArgument();
  const span = (ordinal: number): SpanId => {
    const id = sample.ids.spans[ordinal];
    if (id === undefined) throw new Error(`no span ${String(ordinal)}`);
    return id;
  };
  return { ...sample, span, index: indexArgument(sample.graph, sample.spans) };
}

describe('highlightFor', () => {
  it('lights up the claims a span supports', () => {
    const { index, ids, span } = setup();
    const highlight = highlightFor(index, { type: 'span', id: span(3) });

    expect([...highlight.claims]).toEqual([ids.fact]);
    expect([...highlight.spans]).toEqual([span(3)]);
  });

  it('lights up the spans a claim was stated in', () => {
    const { index, ids, span } = setup();
    expect([...highlightFor(index, { type: 'claim', id: ids.rule }).spans]).toEqual([span(2)]);
  });

  it('lights up no source text for an inferred claim', () => {
    const { index, ids } = setup();
    const highlight = highlightFor(index, { type: 'claim', id: ids.bridge });

    expect([...highlight.claims]).toEqual([ids.bridge]);
    expect(highlight.spans.size).toBe(0);
  });

  it("lights up an inference's premises, conclusion and their spans", () => {
    const { index, ids, span } = setup();
    const highlight = highlightFor(index, { type: 'inference', id: ids.step });

    expect([...highlight.inferences]).toEqual([ids.step]);
    expect(new Set(highlight.claims)).toEqual(
      new Set([ids.rule, ids.fact, ids.bridge, ids.thesis]),
    );
    expect(new Set(highlight.spans)).toEqual(new Set([span(2), span(3), span(5)]));
  });

  it("lights up a finding's targets", () => {
    const { index, ids, span, graph } = setup();
    const uncited = graph.findings.find((f) => f.kind === 'unsupported_claim');
    if (uncited === undefined) throw new Error('fixture has no unsupported_claim finding');

    const highlight = highlightFor(index, { type: 'finding', id: uncited.id });

    expect([...highlight.claims]).toEqual([ids.fact]);
    expect([...highlight.spans]).toEqual([span(3)]);
  });

  it('lights up nothing for no selection or an unknown element', () => {
    const { index } = setup();
    expect(highlightFor(index, null).claims.size).toBe(0);
    expect(highlightFor(index, { type: 'span', id: 'gone' as SpanId }).spans.size).toBe(0);
  });
});

describe('firstSpan', () => {
  it('is the earliest highlighted span in the text', () => {
    const { index, ids, span } = setup();
    expect(firstSpan(index, highlightFor(index, { type: 'inference', id: ids.step }))).toBe(
      span(2),
    );
  });
});

describe('sameSelection', () => {
  it('compares by type and id', () => {
    const { ids } = setup();
    expect(sameSelection({ type: 'claim', id: ids.fact }, { type: 'claim', id: ids.fact })).toBe(
      true,
    );
    expect(sameSelection({ type: 'claim', id: ids.fact }, null)).toBe(false);
    expect(sameSelection(null, null)).toBe(true);
  });
});
