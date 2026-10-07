import { graph } from './builder.ts';
import { and, atom, imp } from './formula.ts';

/**
 * Mirrors `fixtures/arguments/05-contract-notice.expected.yaml`, and the worked
 * example in AGENTS.md section 7.5 (C1 rule + C2 fact + inferred C4 -> C3).
 *
 * The canonical implicit-premise case: the step is valid only once the unstated
 * premise is supplied, which makes that premise load-bearing and the finding
 * `critical`. The weakness is that the premise is unstated, not that the logic
 * fails — so there must be no `invalid_step`.
 */
const b = graph()
  .claim('c1', 'Section 9 requires written notice of breach within 30 days', {
    kind: 'legal_rule',
    citation: 'Supply Agreement, Ex. 1, § 9',
  })
  .claim('c2', 'Bellweather emailed Ostrander on February 7, 28 days after the breach', {
    citation: 'Email of Feb. 7, Ex. 4',
  })
  .inferred('c4', "An email satisfies Section 9's written-notice requirement", {
    kind: 'definitional',
  })
  .thesis('c3', "Bellweather's notice of breach was timely", { kind: 'normative' })
  .infer('i1', ['c1', 'c2', 'c4'], 'c3', { scheme: 'deductive' })
  .formalize('i1', {
    atoms: { N: 'c2', E: 'c4', T: 'c3' },
    premises: [imp(and(atom('N'), atom('E')), atom('T')), atom('N'), atom('E')],
    conclusion: atom('T'),
  });

export const fixture05Graph = b.build();
export const fixture05Spans = b.spanIds;
