import type { Formula } from '@make-your-case/domain';

/** Shorthands so a fixture's formalization reads like the logic it encodes. */
export const atom = (name: string): Formula => ({ atom: name });
export const not = (f: Formula): Formula => ({ not: f });
export const and = (...fs: Formula[]): Formula => ({ and: fs });
export const or = (...fs: Formula[]): Formula => ({ or: fs });
export const imp = (a: Formula, b: Formula): Formula => ({ implies: [a, b] });
