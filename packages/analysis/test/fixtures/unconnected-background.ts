import { graph } from './builder.ts';

/**
 * A sound argument with one piece of background material hanging off it.
 *
 * Required by AGENTS.md section 7.5. The point is the severity: an unconnected
 * claim is a **warning**, so the graph still validates and the pipeline must not
 * retry over it. Briefs state a standard of review or procedural history
 * without arguing from it, and failing those documents would be wrong.
 */
const b = graph()
  .claim('c1', 'The notice period is 14 days', { kind: 'legal_rule', citation: 'Rule 3(a)' })
  .claim('c2', 'Notice was served on day 9', { citation: 'Proof of Service' })
  .claim('c3', 'The court reviews questions of law de novo', {
    kind: 'legal_rule',
    citation: 'Standard of review',
  })
  .thesis('c4', 'Notice was served within the period', { kind: 'normative' })
  .infer('i1', ['c1', 'c2'], 'c4');

export const unconnectedBackgroundGraph = b.build();
export const unconnectedBackgroundSpans = b.spanIds;
