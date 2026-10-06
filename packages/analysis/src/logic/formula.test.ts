import { describe, expect, it } from 'vitest';
import { collectAtoms, evaluate, type Formula } from './formula.ts';

describe('collectAtoms', () => {
  it('returns atoms in first-seen order without duplicates', () => {
    const formula: Formula = { and: [{ atom: 'Q' }, { not: { atom: 'P' } }, { atom: 'Q' }] };
    expect(collectAtoms([formula])).toEqual(['Q', 'P']);
  });

  it('walks both sides of an implication', () => {
    expect(collectAtoms([{ implies: [{ atom: 'A' }, { atom: 'B' }] }])).toEqual(['A', 'B']);
  });
});

describe('evaluate', () => {
  const assignment = { P: true, Q: false };

  it('evaluates atoms, negation, conjunction and disjunction', () => {
    expect(evaluate({ atom: 'P' }, assignment)).toBe(true);
    expect(evaluate({ not: { atom: 'P' } }, assignment)).toBe(false);
    expect(evaluate({ and: [{ atom: 'P' }, { atom: 'Q' }] }, assignment)).toBe(false);
    expect(evaluate({ or: [{ atom: 'P' }, { atom: 'Q' }] }, assignment)).toBe(true);
  });

  it('treats implication as material implication', () => {
    expect(evaluate({ implies: [{ atom: 'P' }, { atom: 'Q' }] }, assignment)).toBe(false);
    expect(evaluate({ implies: [{ atom: 'Q' }, { atom: 'P' }] }, assignment)).toBe(true);
  });

  it('treats an unassigned atom as false', () => {
    expect(evaluate({ atom: 'missing' }, assignment)).toBe(false);
  });

  it('treats an empty conjunction as true and an empty disjunction as false', () => {
    expect(evaluate({ and: [] }, assignment)).toBe(true);
    expect(evaluate({ or: [] }, assignment)).toBe(false);
  });
});
