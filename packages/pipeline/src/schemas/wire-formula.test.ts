import { describe, expect, it } from 'vitest';
import { buildFormula, type WireFormulaNode } from './wire-formula.ts';

const atom = (id: string, name: string): WireFormulaNode => ({
  id,
  op: 'atom',
  atom: name,
  args: [],
});

describe('buildFormula', () => {
  it('builds a nested formula from a node list', () => {
    const nodes: WireFormulaNode[] = [
      atom('f1', 'P'),
      atom('f2', 'Q'),
      { id: 'f3', op: 'not', atom: null, args: ['f2'] },
      { id: 'f4', op: 'implies', atom: null, args: ['f1', 'f3'] },
      { id: 'f5', op: 'and', atom: null, args: ['f1', 'f4'] },
    ];

    expect(buildFormula(nodes, 'f5')).toEqual({
      ok: true,
      formula: { and: [{ atom: 'P' }, { implies: [{ atom: 'P' }, { not: { atom: 'Q' } }] }] },
    });
  });

  it.each([
    [
      'a dangling reference',
      [{ id: 'f1', op: 'not', atom: null, args: ['f9'] }],
      /"f9" does not exist/,
    ],
    ['a cycle', [{ id: 'f1', op: 'not', atom: null, args: ['f1'] }], /refers back to itself/],
    [
      'implies with one arg',
      [atom('f1', 'P'), { id: 'f2', op: 'implies', atom: null, args: ['f1'] }],
      /exactly two/,
    ],
    [
      'and with one arg',
      [atom('f1', 'P'), { id: 'f2', op: 'and', atom: null, args: ['f1'] }],
      /at least two/,
    ],
    [
      'an atom with no name',
      [{ id: 'f2', op: 'atom', atom: null, args: [] }],
      /needs an atom name/,
    ],
  ] as const)('rejects %s', (_label, nodes, message) => {
    const root = nodes[nodes.length - 1]?.id ?? '';
    const result = buildFormula(nodes as readonly WireFormulaNode[], root);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
});
