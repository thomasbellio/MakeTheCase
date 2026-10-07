import { graph } from './builder.ts';

/**
 * Mirrors `fixtures/arguments/02-valid-convergent.expected.yaml`.
 *
 * Three independent routes to the same conclusion. The key's real test: only
 * the filing date, shared by all three routes, is load-bearing — the holiday
 * and the Chair's extension are each used by one route only, so removing
 * either leaves the other two standing.
 */
const b = graph()
  .claim('c1', 'Corwin filed its notice of appeal on June 30', { citation: 'Docket No. 12' })
  .claim('c2', 'Rule 4(a) makes an appeal timely if filed within 30 days of mailing', {
    kind: 'legal_rule',
    citation: 'Rule 4(a)',
  })
  .claim('c3', 'The decision was mailed June 3', { citation: 'Docket No. 8' })
  .claim('c4', 'June 29 was a legal holiday, extending the deadline to June 30 under Rule 4(c)', {
    kind: 'legal_rule',
    citation: 'Rule 4(c)',
  })
  .claim('c5', 'Rule 6 lets the Chair extend deadlines', { kind: 'legal_rule', citation: 'Rule 6' })
  .claim('c6', 'The Chair extended the deadline to July 15', { citation: 'Order of June 20' })
  .claim('c7', "Corwin Bakery's appeal was timely", { kind: 'normative' })
  .thesis('c8', 'The motion to dismiss should be denied', { kind: 'normative' })
  // Route 1: within 30 days of mailing.
  .infer('i1', ['c1', 'c2', 'c3'], 'c7')
  // Route 2: the holiday moved the deadline.
  .infer('i2', ['c1', 'c4'], 'c7')
  // Route 3: the Chair's extension.
  .infer('i3', ['c1', 'c5', 'c6'], 'c7')
  .infer('i4', ['c7'], 'c8');

export const fixture02Graph = b.build();
export const fixture02Spans = b.spanIds;
