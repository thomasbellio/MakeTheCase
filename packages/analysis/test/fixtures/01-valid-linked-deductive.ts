import { graph } from './builder.ts';
import { and, atom, imp } from './formula.ts';

/**
 * Mirrors `fixtures/arguments/01-valid-linked-deductive.expected.yaml`.
 *
 * The happy path: rule, every fact, and the conclusion all stated, every fact
 * cited. Expected findings are `load_bearing` (info) only — no implicit
 * premise, no circularity, no invalid step, no unsupported claim, and the
 * deductive step checks out so it produces no finding either.
 */
const b = graph()
  .claim('c1', 'The lease is a residential tenancy governed by the Act', {
    kind: 'definitional',
    citation: 'Lease, Ex. 1',
  })
  .claim('c2', 'Harlow Properties is the landlord under the lease', {
    citation: 'Lease, Ex. 1 § 1',
  })
  .claim(
    'c3',
    'Section 14.2 requires return of the deposit or an itemized statement within 21 days of vacating',
    { kind: 'legal_rule', citation: 'Act § 14.2' },
  )
  .claim('c4', 'Ms. Okafor vacated on March 1', { citation: 'Okafor Decl. ¶ 3' })
  .claim(
    'c5',
    'By April 15 Harlow had neither returned the deposit nor sent an itemized statement',
    { citation: 'Okafor Decl. ¶ 7' },
  )
  .claim('c6', 'April 15 is more than 21 days after March 1', { kind: 'definitional' })
  .thesis('c7', 'Harlow Properties failed to comply with Section 14.2 of the Act', {
    kind: 'normative',
  })
  .infer('i1', ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], 'c7', { scheme: 'deductive' })
  // One formula per premise, in premise order. The rule claim (c3) carries the
  // implication; the others are the facts it applies to. There is no atom for
  // c3 because its content *is* the implication.
  .formalize('i1', {
    atoms: { D: 'c1', L: 'c2', V: 'c4', N: 'c5', P: 'c6', F: 'c7' },
    premises: [
      atom('D'),
      atom('L'),
      imp(and(atom('V'), atom('N'), atom('P')), atom('F')),
      atom('V'),
      atom('N'),
      atom('P'),
    ],
    conclusion: atom('F'),
  });

export const fixture01Graph = b.build();
export const fixture01Spans = b.spanIds;
