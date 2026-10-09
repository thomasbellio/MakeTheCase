import { z } from 'zod';
import { findingKindSchema, severitySchema, spanFunctionSchema } from '@make-your-case/domain';

/**
 * The answer-key schema (AGENTS.md section 8.7).
 *
 * Each fixture in `fixtures/arguments/` is a pair: `NN-name.md`, which is
 * exactly what a user would paste, and `NN-name.expected.yaml`, this schema.
 * Nothing in the harness hard-codes fixture content; everything it checks comes
 * from a key parsed here.
 */

/** An inclusive bound. Either end may be omitted. */
export const rangeSchema = z
  .object({ min: z.number().optional(), max: z.number().optional() })
  .strict();
export type Range = z.infer<typeof rangeSchema>;

/**
 * Deterministic expectations. **Strict**: an unknown key is an error, so the
 * schema and the fixtures cannot drift apart silently (section 8.7). Adding an
 * expectation means adding it here and teaching the scorer to check it.
 *
 * Every key is optional; all present keys must pass.
 */
export const hardExpectationsSchema = z
  .object({
    /** No revision was produced at all. Used by the non-argument fixtures. */
    argument_graph: z.literal('absent').optional(),

    findings_present: z
      .array(z.object({ kind: findingKindSchema, severity: severitySchema.optional() }).strict())
      .optional(),
    findings_absent: z.array(findingKindSchema).optional(),
    findings_max_severity: severitySchema.optional(),

    claim_count: rangeSchema.optional(),
    inference_count: rangeSchema.optional(),
    relations_count: rangeSchema.optional(),
    relations_present: z.array(z.enum(['rebut', 'undermine', 'undercut', 'qualify'])).optional(),
    inferred_claims: rangeSchema.optional(),
    unsupported_claim_count: rangeSchema.optional(),
    /** The most-occurring claim's occurrence count. */
    max_occurrences_for_single_claim: rangeSchema.optional(),
    claims_with_modality_not_asserted: rangeSchema.optional(),

    // `partialRecord`, not `record`: with an enum key Zod 4 makes a record
    // exhaustive, which would force every fixture to constrain all six
    // discourse functions. A key still has to be a real function name.
    spans_with_function: z.partialRecord(spanFunctionSchema, rangeSchema).optional(),
    /** Occurrences anchored in spans of the given discourse function. */
    claim_occurrences_in_function: z.partialRecord(spanFunctionSchema, rangeSchema).optional(),
  })
  .strict();
export type HardExpectations = z.infer<typeof hardExpectationsSchema>;

/**
 * A soft expectation: prose for the judge to grade.
 *
 * Recursive so a key can group related expectations — fixture 14 groups six
 * behaviours under `embedded_behaviors`, which reads far better than six
 * top-level keys. The judge grades the **leaves**, each identified by its dotted
 * path, so grouping costs nothing in precision.
 *
 * Like `Formula` in section 6, a recursive Zod union needs `z.lazy` with an
 * explicit annotation, so the hand-written type is the source of truth.
 */
export type SoftExpectation = string | string[] | { [key: string]: SoftExpectation };

export const softExpectationSchema: z.ZodType<SoftExpectation> = z.lazy(() =>
  z.union([z.string(), z.array(z.string()), z.record(z.string(), softExpectationSchema)]),
);

export const answerKeySchema = z
  .object({
    /** Matches the file stem. */
    id: z.string().min(1),
    purpose: z.string().min(1),
    expected_status: z.enum(['completed', 'not_an_argument']),
    /** A paraphrase, graded softly. */
    thesis: z.string().nullable(),
    hard: hardExpectationsSchema.default({}),
    /**
     * A written explanation per hard-check row that is known to fail, keyed
     * exactly as the scorer labels the row (`relations_present[undercut]`).
     *
     * Section 8.8 allows a fixture to fall short of a hard check if each
     * failure is explained. The explanation lives beside the expectation it
     * excuses so the two are reviewed together: a generated report is
     * ephemeral, and a separate document drifts.
     */
    expected_failures: z.record(z.string().min(1), z.string().min(1)).default({}),
    soft: z.record(z.string(), softExpectationSchema).default({}),
    notes: z.string().optional(),
  })
  .strict();
export type AnswerKey = z.infer<typeof answerKeySchema>;

/** One graded leaf of `soft`, keyed by its dotted path. */
export interface SoftLeaf {
  readonly path: string;
  readonly expectation: string;
}

/**
 * Every leaf the judge grades: the `soft` tree, plus the top-level `thesis`.
 *
 * Section 8.7 calls `thesis` "graded softly" but puts it outside `soft`, so
 * without this nothing would grade it at all.
 */
export function gradedLeaves(key: AnswerKey): SoftLeaf[] {
  const leaves = softLeaves(key.soft);
  if (key.thesis !== null) {
    leaves.unshift({
      path: 'thesis',
      expectation: `The graph's thesis claim should state, in substance: "${key.thesis}"`,
    });
  }
  return leaves;
}

/**
 * Flattens `soft` into the leaves the judge grades.
 *
 * A string list becomes one leaf whose expectation is the items joined as a
 * bulleted list: the items describe one expectation together, and grading them
 * separately would ask the judge to assess half a thought.
 */
export function softLeaves(soft: Readonly<Record<string, SoftExpectation>>): SoftLeaf[] {
  const leaves: SoftLeaf[] = [];

  const walk = (value: SoftExpectation, path: string): void => {
    if (typeof value === 'string') {
      leaves.push({ path, expectation: value });
    } else if (Array.isArray(value)) {
      leaves.push({ path, expectation: value.map((item) => `- ${item}`).join('\n') });
    } else {
      for (const [key, nested] of Object.entries(value)) {
        walk(nested, path === '' ? key : `${path}.${key}`);
      }
    }
  };

  walk(soft, '');
  return leaves;
}
