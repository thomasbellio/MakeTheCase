import type { AnalysisContext } from './analyzer.ts';

/**
 * Phrasing helpers for finding explanations.
 *
 * Explanations are observations about propositions and the reasoning connecting
 * them. They never name a fallacy, never describe what an author believed or
 * intended, and never reach a verdict about a person (AGENTS.md section 1).
 */

/** Quotes a claim's text for inclusion in a sentence. */
export function q(text: string): string {
  return `“${text}”`;
}

/** `a`, `a and b`, `a, b and c`. */
export function list(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** The canonical text of a claim, or its id if the graph does not contain it. */
export function claimText<Id extends string>(ctx: AnalysisContext<Id>, id: Id): string {
  return ctx.index.claimById.get(id)?.canonical_text ?? id;
}
