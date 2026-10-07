import { graph } from './builder.ts';

/**
 * Mirrors `fixtures/arguments/08-bald-assertion.expected.yaml`.
 *
 * Four properly cited facts and one bald assertion. The uniqueness claim
 * carries an element of the rule by itself, so it is load-bearing as well as
 * uncited — exactly one `unsupported_claim`.
 */
const b = graph()
  .claim(
    'c1',
    'Section 9.4 permits a variance for a practical difficulty unique to the property and not created by the owner',
    { kind: 'legal_rule', citation: 'Zoning Code § 9.4' },
  )
  .claim('c2', 'The rear half of the lot slopes at 30 percent', { citation: 'Survey, Ex. 2' })
  .claim(
    'c3',
    'An addition within the setback would require retaining walls costing more than the addition',
    { citation: 'Architect Letter, Ex. 3' },
  )
  // The bald assertion: no citation, and nothing supports it.
  .claim('c4', 'No other lot on Ridgeway Lane has a comparable slope')
  .claim('c5', "The slope predates the Hendersons' 2015 purchase", { citation: 'Plat and Deed, Ex. 4' })
  .thesis('c6', "The Board should grant the Hendersons' setback variance", { kind: 'normative' })
  .infer('i1', ['c1', 'c2', 'c3', 'c4', 'c5'], 'c6');

export const fixture08Graph = b.build();
export const fixture08Spans = b.spanIds;
