import { graph } from './builder.ts';

/**
 * Mirrors `fixtures/arguments/06-circular.expected.yaml`.
 *
 * The log's reliability rests on the summaries' accuracy, and the summaries'
 * accuracy rests on the log's reliability. Expected: `circularity` (critical),
 * no `invalid_step`, and — per the key — `load_bearing` on "the maintenance log
 * is reliable", the claim the rest of the argument leans on.
 */
const b = graph()
  .claim('c1', 'Regulation 7.3 requires brake inspection at least every 90 days', {
    kind: 'legal_rule',
    citation: 'Reg. 7.3',
  })
  .claim('c2', 'The log records inspections on Feb 2, Apr 28 and Jul 19', {
    citation: 'Maintenance Log, Ex. 2',
  })
  .claim('c3', 'The maintenance log is reliable', { kind: 'normative' })
  .claim('c4', 'The log matches the monthly compliance summaries', {
    citation: 'Compliance Summaries, Ex. 3',
  })
  .claim('c5', 'The compliance summaries are accurate', { kind: 'normative' })
  .claim('c6', 'The summaries are compiled from the maintenance log', {
    citation: 'Vance Decl. ¶ 5',
  })
  .claim('c7', 'The recorded inspections actually took place', { kind: 'factual' })
  .thesis('c8', 'Coastline complied with Regulation 7.3', { kind: 'normative' })
  // The loop: reliability <- accuracy, accuracy <- reliability.
  .infer('i1', ['c4', 'c5'], 'c3')
  .infer('i2', ['c3', 'c6'], 'c5')
  .infer('i3', ['c3'], 'c7')
  .infer('i4', ['c1', 'c2', 'c7'], 'c8');

export const fixture06Graph = b.build();
export const fixture06Spans = b.spanIds;
