import { z } from 'zod';
import type { Formula } from '@make-your-case/domain';

/**
 * `Formula` as models produce it: a flat list of nodes that reference each
 * other by ID, rather than a recursive tree.
 *
 * A recursive Zod schema compiles to a self-`$ref`, which structured-output
 * modes support inconsistently (AGENTS.md section 8.1), and a depth-bounded
 * copy inlines every level into a schema that grows exponentially. A node list
 * is flat, small, and accepted by strict modes; `buildFormula` turns it back
 * into the tree the analysis layer expects.
 */
export const wireFormulaNodeSchema = z.object({
  id: z.string().describe('Node ID, unique within this formalization, e.g. "f1"'),
  op: z.enum(['atom', 'not', 'and', 'or', 'implies']),
  atom: z
    .string()
    .nullable()
    .describe('For op "atom": the atom name from `atoms`. Otherwise null.'),
  args: z
    .array(z.string())
    .describe(
      'Child node IDs: none for atom, one for not, two or more for and/or, exactly two for implies (antecedent, consequent).',
    ),
});
export type WireFormulaNode = z.infer<typeof wireFormulaNodeSchema>;

export type BuildFormulaResult =
  | { readonly ok: true; readonly formula: Formula }
  | { readonly ok: false; readonly message: string };

/** Builds the formula rooted at `rootId`, rejecting dangling references, cycles and bad arity. */
export function buildFormula(
  nodes: readonly WireFormulaNode[],
  rootId: string,
): BuildFormulaResult {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  function build(id: string, path: ReadonlySet<string>): Formula | string {
    const node = byId.get(id);
    if (node === undefined) return `formula node "${id}" does not exist`;
    if (path.has(id)) return `formula node "${id}" refers back to itself`;
    const nextPath = new Set(path).add(id);

    const children: Formula[] = [];
    for (const arg of node.args) {
      const child = build(arg, nextPath);
      if (typeof child === 'string') return child;
      children.push(child);
    }

    const [first, second] = children;
    switch (node.op) {
      case 'atom':
        if (node.atom === null || node.atom === '' || children.length > 0) {
          return `atom node "${id}" needs an atom name and no args`;
        }
        return { atom: node.atom };
      case 'not':
        if (first === undefined || children.length !== 1)
          return `not node "${id}" needs exactly one arg`;
        return { not: first };
      case 'and':
      case 'or':
        if (children.length < 2) return `${node.op} node "${id}" needs at least two args`;
        return node.op === 'and' ? { and: children } : { or: children };
      case 'implies':
        if (first === undefined || second === undefined || children.length !== 2) {
          return `implies node "${id}" needs exactly two args (antecedent, consequent)`;
        }
        return { implies: [first, second] };
    }
  }

  const result = build(rootId, new Set());
  return typeof result === 'string'
    ? { ok: false, message: result }
    : { ok: true, formula: result };
}
