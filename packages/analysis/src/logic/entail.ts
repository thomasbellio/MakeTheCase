import { collectAtoms, evaluate, type Assignment, type Formula } from './formula.ts';

/**
 * Above this many distinct atoms we decline to check rather than enumerate
 * 2^n assignments. Real formalizations produced by reconstruction have a
 * handful of atoms; anything larger signals a malformed formalization, and
 * Phase 1 maps `too_many_atoms` to an `unchecked_step` finding (info) rather
 * than claiming the step is invalid.
 */
export const MAX_ATOMS = 20;

export type EntailmentResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'counterexample'; readonly counterexample: Assignment }
  | { readonly ok: false; readonly reason: 'too_many_atoms'; readonly atomCount: number };

/**
 * Decides whether `premises` jointly entail `conclusion` in classical
 * propositional logic.
 *
 * This replaces the `logic-solver` SAT dependency named in an earlier draft of
 * AGENTS.md section 3, which has been unmaintained since 2016. Entailment holds
 * exactly when `premises AND NOT conclusion` is unsatisfiable, so we enumerate
 * every assignment and look for a model of that conjunction. The first model
 * found is returned as the counterexample, which is what the
 * `deductive-validity` analyzer reports in an `invalid_step` explanation
 * (AGENTS.md section 7.3).
 *
 * Pure and deterministic: atoms are enumerated in first-seen order and
 * assignments in a fixed order, so the same input always yields the same
 * counterexample.
 */
export function entails(premises: readonly Formula[], conclusion: Formula): EntailmentResult {
  const atoms = collectAtoms([...premises, conclusion]);

  if (atoms.length > MAX_ATOMS) {
    return { ok: false, reason: 'too_many_atoms', atomCount: atoms.length };
  }

  const total = 2 ** atoms.length;

  for (let mask = 0; mask < total; mask += 1) {
    const assignment: Record<string, boolean> = {};
    for (const [index, atom] of atoms.entries()) {
      // Bit `index` of `mask` is this atom's truth value.
      assignment[atom] = (mask & (1 << index)) !== 0;
    }

    const premisesHold = premises.every((premise) => evaluate(premise, assignment));
    if (premisesHold && !evaluate(conclusion, assignment)) {
      return { ok: false, reason: 'counterexample', counterexample: assignment };
    }
  }

  return { ok: true };
}
