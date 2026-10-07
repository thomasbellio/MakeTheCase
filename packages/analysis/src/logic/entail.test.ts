import { describe, expect, it } from 'vitest';
import { entails, MAX_ATOMS } from './entail.ts';
import type { Formula } from '@make-your-case/domain';

const P: Formula = { atom: 'P' };
const Q: Formula = { atom: 'Q' };
const R: Formula = { atom: 'R' };

describe('entails', () => {
  it('accepts modus ponens', () => {
    // P, P -> Q  therefore  Q
    expect(entails([P, { implies: [P, Q] }], Q)).toEqual({ ok: true });
  });

  it('rejects affirming the consequent, with a counterexample', () => {
    // P -> Q, Q  therefore  P   (the fixture 07 case: certified -> compliant,
    // compliant, therefore certified)
    const result = entails([{ implies: [P, Q] }, Q], P);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'counterexample') {
      throw new Error('expected a counterexample');
    }
    // The counterexample must make the premises true and the conclusion false:
    // Q holds, P does not.
    expect(result.counterexample).toEqual({ P: false, Q: true });
  });

  it('accepts modus tollens', () => {
    // P -> Q, NOT Q  therefore  NOT P
    expect(entails([{ implies: [P, Q] }, { not: Q }], { not: P })).toEqual({ ok: true });
  });

  it('rejects denying the antecedent', () => {
    const result = entails([{ implies: [P, Q] }, { not: P }], { not: Q });
    expect(result.ok).toBe(false);
  });

  it('accepts a hypothetical syllogism', () => {
    // P -> Q, Q -> R  therefore  P -> R
    expect(entails([{ implies: [P, Q] }, { implies: [Q, R] }], { implies: [P, R] })).toEqual({
      ok: true,
    });
  });

  it('accepts conjunction elimination and rejects its converse', () => {
    expect(entails([{ and: [P, Q] }], P)).toEqual({ ok: true });

    const result = entails([P], { and: [P, Q] });
    expect(result.ok).toBe(false);
  });

  it('accepts disjunctive syllogism', () => {
    // P OR Q, NOT P  therefore  Q
    expect(entails([{ or: [P, Q] }, { not: P }], Q)).toEqual({ ok: true });
  });

  it('treats contradictory premises as entailing anything', () => {
    // No assignment satisfies the premises, so there is no counterexample.
    expect(entails([P, { not: P }], Q)).toEqual({ ok: true });
  });

  it('rejects a conclusion unrelated to its premises', () => {
    const result = entails([P], Q);
    expect(result.ok).toBe(false);
  });

  it('declines to check formulas with too many atoms', () => {
    const atoms: Formula[] = Array.from({ length: MAX_ATOMS + 1 }, (_, i) => ({
      atom: `A${String(i)}`,
    }));
    const result = entails(atoms, { atom: 'Z' });

    expect(result).toEqual({
      ok: false,
      reason: 'too_many_atoms',
      atomCount: MAX_ATOMS + 2,
    });
  });

  it('is deterministic: the same input yields the same counterexample', () => {
    const first = entails([{ implies: [P, Q] }, Q], P);
    const second = entails([{ implies: [P, Q] }, Q], P);
    expect(first).toEqual(second);
  });
});
