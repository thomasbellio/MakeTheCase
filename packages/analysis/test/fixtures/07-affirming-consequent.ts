import { graph } from './builder.ts';
import { atom, imp } from './formula.ts';

/**
 * Mirrors `fixtures/arguments/07-affirming-consequent.expected.yaml`.
 *
 * The text states "certified -> compliant", establishes "compliant", and
 * concludes "certified". The conditional is formalized in the direction the
 * text states it, per the reconstruction policy in AGENTS.md section 8.3 rule
 * 3 — so this reports `invalid_step` rather than being quietly repaired by
 * adding the converse.
 */
const b = graph()
  .claim(
    'c1',
    'Section 14 makes final payment due once the work is certified by the City Building Inspector',
    { kind: 'legal_rule', citation: 'Contract, Ex. 1 § 14' },
  )
  .claim('c2', 'Code § 3.1 deems certified work to be code-compliant', {
    kind: 'legal_rule',
    citation: 'Code § 3.1',
  })
  .claim("c3", "Halvorsen's work is fully code-compliant", {
    citation: "Engineer's Report, Ex. 4",
  })
  .claim('c4', "Halvorsen's work has the required certification", { kind: 'factual' })
  .thesis('c5', 'Final payment to Halvorsen is due', { kind: 'normative' })
  // The invalid step: from "certified -> compliant" and "compliant", to "certified".
  .infer('i1', ['c2', 'c3'], 'c4', { scheme: 'deductive' })
  .formalize('i1', {
    atoms: { C: 'c4', K: 'c3' },
    premises: [imp(atom('C'), atom('K')), atom('K')],
    conclusion: atom('C'),
  })
  // This second step is valid and must not be flagged.
  .infer('i2', ['c1', 'c4'], 'c5', { scheme: 'deductive' })
  .formalize('i2', {
    atoms: { C: 'c4', P: 'c5' },
    premises: [imp(atom('C'), atom('P')), atom('C')],
    conclusion: atom('P'),
  });

export const fixture07Graph = b.build();
export const fixture07Spans = b.spanIds;
