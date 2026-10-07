import { graph } from './builder.ts';

/**
 * Mirrors `fixtures/arguments/04-counterargument-rebuttal.expected.yaml`.
 *
 * The attribution fixture. The insurer's claims must not act as premises the
 * author asserts, and must contribute nothing to support.
 *
 * It also pins the analyzer-scope decision: the insurer's step from "water
 * accumulated in the basement" to "the loss was flooding" is the target of the
 * author's undercut, and the key requires **no** `invalid_step` — validity
 * checking looks only at the author's own reasoning.
 */
const b = graph()
  .claim('c1', 'Section 2 covers sudden and accidental discharge from within a plumbing system', {
    kind: 'legal_rule',
    citation: 'Policy, Ex. A § 2',
  })
  .claim('c2', 'A supply line under the kitchen sink burst on February 9', {
    citation: 'Lin Decl. ¶ 4',
  })
  .claim('c3', 'Section 5(d) defines flood as water originating outside the dwelling', {
    kind: 'definitional',
    citation: 'Policy, Ex. A § 5(d)',
  })
  .claim('c4', 'All the water came from the burst supply line inside the house', {
    citation: 'Alvarez Report, Ex. C',
  })
  .thesis('c5', "The policy covers Ms. Lin's water damage", { kind: 'normative' })
  // The insurer's position, attributed to the insurer.
  .opposing('o1', 'The flood exclusion in Section 5(d) bars coverage', { kind: 'normative' })
  .opposing('o2', 'Water accumulated in the basement', { citation: 'Adjuster Report, Ex. B' })
  .opposing('o3', 'The loss was flooding', { kind: 'normative' })
  // The author's own route to coverage.
  .infer('i1', ['c1', 'c2'], 'c5')
  // The insurer's own step, modelled so the undercut has something to target.
  .infer('i2', ['o2'], 'o3', { attribution: 'opposing' })
  .infer('i3', ['o3'], 'o1', { attribution: 'opposing' })
  // The author's answers.
  .relate('r1', 'rebut', 'o1', { claim: 'c5' })
  .relate('r2', 'undermine', 'c4', { claim: 'o3' })
  .relate('r3', 'undercut', 'c3', { inference: 'i2' });

export const fixture04Graph = b.build();
export const fixture04Spans = b.spanIds;
