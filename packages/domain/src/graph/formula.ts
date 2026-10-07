import { z } from 'zod';

/**
 * Propositional formulas, attached by reconstruction to `deductive` inferences
 * (AGENTS.md section 6, "Formalization").
 *
 * Atom names are arbitrary labels (`P`, `Q`, ...); the owning `Formalization`
 * maps each one to the claim it stands for.
 *
 * This hand-written type is the source of truth and `formulaSchema` is checked
 * against it — the one documented exception to section 7.2's "types inferred
 * from Zod schemas", because a recursive union needs `z.lazy` and an explicit
 * annotation (without it `z.infer` degrades to `any`).
 */
export type Formula =
  | { atom: string }
  | { not: Formula }
  | { and: Formula[] }
  | { or: Formula[] }
  | { implies: [Formula, Formula] };

export const formulaSchema: z.ZodType<Formula> = z.lazy(() =>
  z.union([
    z.strictObject({ atom: z.string().min(1) }),
    z.strictObject({ not: formulaSchema }),
    z.strictObject({ and: z.array(formulaSchema).min(2) }),
    z.strictObject({ or: z.array(formulaSchema).min(2) }),
    z.strictObject({ implies: z.tuple([formulaSchema, formulaSchema]) }),
  ]),
);

/**
 * A deductive step's propositional form.
 *
 * `premises` has one formula per premise, in premise order. `atoms` maps each
 * atom name to the claim it represents, so an explanation can name claims
 * rather than letters. Parameterised by ID type because a draft's formalization
 * references local IDs and a persisted one references claim UUIDs.
 */
export interface Formalization<Id extends string> {
  readonly atoms: Readonly<Record<string, Id>>;
  readonly premises: readonly Formula[];
  readonly conclusion: Formula;
}

/** Builds a `Formalization` schema over the given ID schema. */
export function formalizationSchema<T extends z.ZodType<string>>(idSchema: T) {
  return z
    .object({
      atoms: z.record(z.string().min(1), idSchema),
      // Readonly so the inferred type matches the hand-written
      // `Formalization<Id>`, which is the source of truth.
      premises: z.array(formulaSchema).readonly(),
      conclusion: formulaSchema,
    })
    .readonly();
}
