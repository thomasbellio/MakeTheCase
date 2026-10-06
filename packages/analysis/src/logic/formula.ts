/**
 * Propositional formulas, as produced by the reconstruction stage for
 * `deductive` inferences (AGENTS.md section 6, "Formalization").
 *
 * Atom names are arbitrary labels (`P`, `Q`, ...); the owning `Formalization`
 * maps each one to a claim local ID.
 */
export type Formula =
  | { atom: string }
  | { not: Formula }
  | { and: Formula[] }
  | { or: Formula[] }
  | { implies: [Formula, Formula] };

/** A truth assignment over atom names. */
export type Assignment = Readonly<Record<string, boolean>>;

/** Collects every atom name appearing in the given formulas, in first-seen order. */
export function collectAtoms(formulas: readonly Formula[]): string[] {
  const seen = new Set<string>();

  const walk = (formula: Formula): void => {
    if ('atom' in formula) {
      seen.add(formula.atom);
    } else if ('not' in formula) {
      walk(formula.not);
    } else if ('and' in formula) {
      formula.and.forEach(walk);
    } else if ('or' in formula) {
      formula.or.forEach(walk);
    } else {
      walk(formula.implies[0]);
      walk(formula.implies[1]);
    }
  };

  formulas.forEach(walk);
  return [...seen];
}

/**
 * Evaluates a formula under an assignment.
 *
 * An atom missing from the assignment is treated as false. Callers in this
 * package always supply a total assignment, so this is a defensive default
 * rather than a meaningful case.
 */
export function evaluate(formula: Formula, assignment: Assignment): boolean {
  if ('atom' in formula) {
    return assignment[formula.atom] ?? false;
  }
  if ('not' in formula) {
    return !evaluate(formula.not, assignment);
  }
  if ('and' in formula) {
    return formula.and.every((f) => evaluate(f, assignment));
  }
  if ('or' in formula) {
    return formula.or.some((f) => evaluate(f, assignment));
  }
  return !evaluate(formula.implies[0], assignment) || evaluate(formula.implies[1], assignment);
}
