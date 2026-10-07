import { describe, expect, it } from 'vitest';
import { localId, toView, type Formula } from '@make-your-case/domain';
import { analyzeArgumentGraph } from '../src/analyze/analyze-argument-graph.ts';
import { validateArgumentGraph } from '../src/validate/validate-argument-graph.ts';
import { MAX_ATOMS } from '../src/logic/entail.ts';
import { list, q } from '../src/analyze/explain.ts';
import { graph } from './fixtures/builder.ts';
import { atom, imp } from './fixtures/formula.ts';

describe('explanation helpers', () => {
  it('quotes text', () => {
    expect(q('a claim')).toBe('“a claim”');
  });

  it('joins zero, one, two and three items readably', () => {
    expect(list([])).toBe('');
    expect(list(['a'])).toBe('a');
    expect(list(['a', 'b'])).toBe('a and b');
    expect(list(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('a graph with no thesis', () => {
  it('yields no findings, since every explanation is about what the argument is for', () => {
    const draft = graph().claim('c1', 'A claim with nothing to prove').build();
    expect(analyzeArgumentGraph(toView(draft))).toEqual([]);
  });
});

describe('deductive steps that cannot be checked', () => {
  it('reports a missing formalization as unchecked, never invalid', () => {
    const draft = graph()
      .claim('c1', 'A premise')
      .thesis('c2', 'A conclusion')
      .infer('i1', ['c1'], 'c2', { scheme: 'deductive' })
      .build();

    const findings = analyzeArgumentGraph(toView(draft));
    const unchecked = findings.filter((f) => f.kind === 'unchecked_step');
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]?.severity).toBe('info');
    expect(unchecked[0]?.explanation).toContain('no propositional formalization is attached');
    expect(findings.some((f) => f.kind === 'invalid_step')).toBe(false);
  });

  it('reports an oversized formalization as unchecked, saying why', () => {
    // More atoms than the checker will enumerate.
    const atoms: Record<string, string> = {};
    const premises: Formula[] = [];
    const b = graph();
    for (let i = 0; i <= MAX_ATOMS; i += 1) {
      b.claim(`c${String(i)}`, `Premise ${String(i)}`);
      atoms[`A${String(i)}`] = `c${String(i)}`;
      premises.push(atom(`A${String(i)}`));
    }
    const thesisId = `c${String(MAX_ATOMS + 1)}`;
    b.thesis(thesisId, 'The conclusion');
    atoms.T = thesisId;

    const draft = b
      .infer(
        'i1',
        Array.from({ length: MAX_ATOMS + 1 }, (_, i) => `c${String(i)}`),
        thesisId,
        { scheme: 'deductive' },
      )
      .formalize('i1', { atoms, premises, conclusion: atom('T') })
      .build();

    const findings = analyzeArgumentGraph(toView(draft));
    const unchecked = findings.filter((f) => f.kind === 'unchecked_step');
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]?.explanation).toContain('distinct propositions');
    expect(findings.some((f) => f.kind === 'invalid_step')).toBe(false);
  });

  it('does not check a non-deductive step at all', () => {
    const draft = graph()
      .claim('c1', 'A cause')
      .thesis('c2', 'An effect')
      .infer('i1', ['c1'], 'c2', { scheme: 'causal' })
      .build();

    const findings = analyzeArgumentGraph(toView(draft));
    expect(findings.some((f) => f.kind === 'unchecked_step')).toBe(false);
  });
});

describe('an inferred claim used only as a conclusion', () => {
  it('is not reported as an implicit premise', () => {
    const draft = graph()
      .claim('c1', 'A stated premise')
      .inferred('c2', 'An inferred intermediate conclusion')
      .thesis('c3', 'The thesis')
      .infer('i1', ['c1'], 'c2')
      .infer('i2', ['c1'], 'c3')
      .build();

    const findings = analyzeArgumentGraph(toView(draft));
    expect(findings.some((f) => f.kind === 'implicit_premise')).toBe(false);
  });
});

describe('validation edge cases', () => {
  const spans = [localId('s1'), localId('s2')];

  it('rejects a formalization on a non-deductive step', () => {
    const draft = graph()
      .claim('c1', 'A premise')
      .thesis('c2', 'A conclusion')
      .infer('i1', ['c1'], 'c2', { scheme: 'causal' })
      .formalize('i1', {
        atoms: { P: 'c1', Q: 'c2' },
        premises: [atom('P')],
        conclusion: atom('Q'),
      })
      .build();

    const result = validateArgumentGraph(draft, spans);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.rule)).toContain('formalization-scheme');
  });

  it('rejects a formalization with the wrong number of premise formulas', () => {
    const draft = graph()
      .claim('c1', 'First premise')
      .claim('c2', 'Second premise')
      .thesis('c3', 'A conclusion')
      .infer('i1', ['c1', 'c2'], 'c3', { scheme: 'deductive' })
      .formalize('i1', {
        atoms: { P: 'c1', R: 'c3' },
        premises: [atom('P')],
        conclusion: atom('R'),
      })
      .build();

    const result = validateArgumentGraph(draft, [...spans, localId('s3')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.rule)).toContain('formalization-arity');
  });

  it('rejects an atom used in a formula but bound to no claim', () => {
    const draft = graph()
      .claim('c1', 'A premise')
      .thesis('c2', 'A conclusion')
      .infer('i1', ['c1'], 'c2', { scheme: 'deductive' })
      .formalize('i1', {
        atoms: { P: 'c1' },
        premises: [imp(atom('P'), atom('UNBOUND'))],
        conclusion: atom('UNBOUND'),
      })
      .build();

    const result = validateArgumentGraph(draft, spans);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('UNBOUND'))).toBe(true);
  });

  it('rejects an inferred claim attributed to anyone but the author', () => {
    const draft = graph()
      .claim('c1', 'A premise')
      .inferred('c2', 'An inferred claim', { attribution: 'opposing' })
      .thesis('c3', 'A conclusion')
      .infer('i1', ['c1', 'c2'], 'c3')
      .build();

    const result = validateArgumentGraph(draft, spans);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.rule)).toContain('inferred-attribution');
  });

  it('rejects a thesis attributed to the opponent', () => {
    const draft = graph()
      .claim('c1', 'A premise')
      .thesis('c2', 'A conclusion', { attribution: 'opposing' })
      .infer('i1', ['c1'], 'c2', { attribution: 'author' })
      .build();

    const result = validateArgumentGraph(draft, spans);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.rule)).toContain('thesis-attribution');
  });

  it('rejects a premise row whose origin disagrees with its claim', () => {
    const draft = graph()
      .claim('c1', 'A stated premise')
      .thesis('c2', 'A conclusion')
      .infer('i1', ['c1'], 'c2')
      .patch((d) => {
        const premise = d.premises[0];
        if (premise !== undefined) d.premises[0] = { ...premise, origin: 'inferred' };
      })
      .build();

    const result = validateArgumentGraph(draft, spans);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.rule)).toContain('premise-origin-mismatch');
  });

  it('allows a qualify relation within one party', () => {
    const draft = graph()
      .claim('c1', 'A premise')
      .claim('c2', 'A narrowing claim')
      .thesis('c3', 'A conclusion')
      .infer('i1', ['c1'], 'c3')
      .relate('r1', 'qualify', 'c2', { claim: 'c3' })
      .build();

    const result = validateArgumentGraph(draft, [...spans, localId('s3')]);
    expect(result.ok).toBe(true);
  });

  it('rejects a relation with neither target set', () => {
    const draft = graph()
      .claim('c1', 'A premise')
      .thesis('c2', 'A conclusion')
      .infer('i1', ['c1'], 'c2')
      .patch((d) => {
        d.relations.push({
          id: localId('r1'),
          type: 'rebut',
          source_claim_id: localId('c1'),
          target_claim_id: null,
          target_inference_id: null,
        });
      })
      .build();

    const result = validateArgumentGraph(draft, spans);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.rule)).toContain('relation-target');
  });

  it('rejects two claims sharing an ID', () => {
    const draft = graph()
      .claim('c1', 'A premise')
      .thesis('c2', 'A conclusion')
      .infer('i1', ['c1'], 'c2')
      .patch((d) => {
        const first = d.claims[0];
        if (first !== undefined) d.claims.push({ ...first, canonical_text: 'A duplicate' });
      })
      .build();

    const result = validateArgumentGraph(draft, spans);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.rule)).toContain('duplicate-id');
  });

  it('rejects an occurrence pointing at a span that was never segmented', () => {
    const draft = graph()
      .claim('c1', 'A premise')
      .thesis('c2', 'A conclusion')
      .infer('i1', ['c1'], 'c2')
      .build();
    // Only s1 exists as far as the caller is concerned.
    const result = validateArgumentGraph(draft, [localId('s1')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('span s2'))).toBe(true);
  });
});
