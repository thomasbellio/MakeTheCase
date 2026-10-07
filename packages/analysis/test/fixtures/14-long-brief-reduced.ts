import { graph } from './builder.ts';

/**
 * A reduced stand-in for `fixtures/arguments/14-long-brief.expected.yaml`.
 *
 * The source is a ~2,300-word brief whose answer key expects 25–60 claims. This
 * graph is about twenty, and deliberately so: every finding the key expects is
 * determined by the brief's *structure*, not its length, and the keys that do
 * need the whole document (`claim_count`, `spans_with_function`, occurrence
 * counts) are properties of segmentation, classification and extraction, which
 * a hand-typed graph cannot honestly demonstrate. Those belong to `pnpm eval`
 * (AGENTS.md section 8.7). Behaviour at scale is covered by the generated
 * graphs in `support.test.ts`.
 *
 * Local IDs follow the pipeline's own format (AGENTS.md section 5.3), so the
 * legend below is the map from ID to the claim it carries:
 *
 *   c1  thesis: summary judgment          c13 rent paid on time (UNCITED)
 *   c2  renewal validly exercised         c14 no non-monetary Default
 *   c3  Section 4.2 rule                  c15 written consent to the sign
 *   c4  notice was timely                 c16 injunction warranted
 *   c5  not in Default on May 2           c17 Marlow rule
 *   c6  Section 22 delivery rule          c18 irreparable harm (hedged)
 *   c7  delivered May 2 (restated)        c19 relocation cost (hedged)
 *   c8  renewal window closed May 4       c20 loss uncompensable (hedged)
 *   c9  Pemberton's conduct               c21 Rule 56(a) (unconnected)
 *   c10 waiver rule (INFERRED)            c22-c25 Pemberton's position
 *   c11 Section 19.1 rule
 *   c12 no monetary Default               i2 route A.1    i3 route A.2
 *
 * Every behaviour the key names is preserved:
 *   - two alternative routes to "the notice was timely" (A.1 delivery, A.2 waiver)
 *   - route A.2's inferred premise, `warning` not `critical` because A.1 survives
 *   - one uncited load-bearing fact -> exactly one `unsupported_claim`
 *   - rebut, undermine and undercut relations against the opponent
 *   - three hedged claims in the injunction branch
 *   - one unconnected background claim (warning, not an error)
 */
const b = graph()
  .thesis('c1', 'The Court should grant summary judgment for Brightwater', { kind: 'normative' })

  // --- Branch I: the renewal option was validly exercised ---
  .claim('c2', 'Brightwater validly exercised its renewal option', { kind: 'normative' })
  .claim('c3', 'Section 4.2 makes a renewal effective on timely notice absent a Default', {
    kind: 'legal_rule',
    citation: 'Lease, Ex. 1 § 4.2',
  })
  .claim('c4', 'The renewal notice was timely', { kind: 'normative' })
  .claim('c5', 'Brightwater was not in Default on May 2', { kind: 'normative' })

  // Route A.1 — delivery under Section 22.
  .claim('c6', 'Section 22 makes the signed courier receipt the measure of delivery', {
    kind: 'legal_rule',
    citation: 'Lease, Ex. 1 § 22',
  })
  .claim('c7', 'Brightwater delivered its renewal notice on May 2', {
    citation: 'Courier Receipt, Ex. 6',
  })
  .claim('c8', 'The renewal window closed on May 4', { citation: 'Lease, Ex. 1 § 4.1' })

  // Route A.2 — waiver by conduct, completed by an unstated rule.
  .claim('c9', "Pemberton's conduct treated the renewal as effective", {
    citation: 'Whitcomb Decl. ¶ 12',
  })
  .inferred(
    'c10',
    'A landlord that treats a renewal as effective after receiving notice waives objections to its timeliness',
    { kind: 'legal_rule' },
  )

  // Default analysis. The rent claim is the single uncited load-bearing fact:
  // the brief cites "Undisputed Fact ¶ 17", an internal cross-reference to a
  // paragraph that itself cites nothing, which is not a record citation.
  .claim('c11', 'Section 19.1 defines Default as a monetary or non-monetary breach', {
    kind: 'legal_rule',
    citation: 'Lease, Ex. 1 § 19.1',
  })
  .claim('c12', 'There was no monetary Default', { kind: 'normative' })
  .claim('c13', 'Brightwater has paid every installment of rent on time')
  .claim('c14', 'There was no non-monetary Default', { kind: 'normative' })
  .claim('c15', 'Pemberton consented in writing to the sign on March 9', {
    citation: 'Letter of Mar. 9, Ex. 9',
  })

  // --- Branch II: an injunction is warranted. Hedged throughout. ---
  .claim('c16', 'A permanent injunction is warranted', { kind: 'normative' })
  .claim('c17', 'Marlow requires success on the merits and irreparable harm', {
    kind: 'legal_rule',
    citation: 'Marlow v. Pine, 400 A.2d 1',
  })
  .claim('c18', 'Brightwater would likely suffer irreparable harm', {
    kind: 'predictive',
    modality: 'probable',
    citation: 'Whitcomb Decl. ¶ 20',
  })
  .claim('c19', 'Relocation would probably cost Brightwater a substantial share of its members', {
    kind: 'predictive',
    modality: 'probable',
    citation: 'Whitcomb Decl. ¶ 22',
  })
  .claim('c20', 'The loss would likely be impossible to compensate fully', {
    kind: 'predictive',
    modality: 'probable',
    citation: 'Whitcomb Decl. ¶ 24',
  })

  // Background: stated, cited, and argued from by nobody.
  .claim('c21', 'Rule 56(a) states the summary judgment standard', {
    kind: 'legal_rule',
    citation: 'Rule 56(a)',
  })

  // --- The opponent ---
  .opposing('c22', 'The renewal notice was delivered on May 6', {
    citation: 'Mail Log, Ex. 11',
  })
  .opposing('c23', 'The renewal notice was late', { kind: 'normative' })
  .opposing('c24', 'Brightwater was in Default because of the sign', { kind: 'normative' })
  .opposing('c25', 'The sign was installed without consent', {})

  // --- Author inferences ---
  .infer('i1', ['c3', 'c4', 'c5'], 'c2')
  // Two independent routes to "the notice was timely".
  .infer('i2', ['c6', 'c7', 'c8'], 'c4')
  .infer('i3', ['c9', 'c10'], 'c4')
  .infer('i4', ['c11', 'c12', 'c14'], 'c5')
  .infer('i5', ['c13'], 'c12')
  .infer('i6', ['c15'], 'c14')
  .infer('i7', ['c17', 'c2', 'c18'], 'c16')
  .infer('i8', ['c19', 'c20'], 'c18')
  .infer('i9', ['c2', 'c16'], 'c1')

  // --- The opponent's own reasoning, so the undercut has a target ---
  .infer('i10', ['c22'], 'c23', { attribution: 'opposing' })
  .infer('i11', ['c25'], 'c24', { attribution: 'opposing' })

  // --- Answers ---
  .relate('r1', 'rebut', 'c23', { claim: 'c4' })
  .relate('r2', 'rebut', 'c24', { claim: 'c5' })
  .relate('r3', 'undermine', 'c15', { claim: 'c25' })
  .relate('r4', 'undercut', 'c6', { inference: 'i10' })

  // The delivery claim is restated through the brief; the key expects at least
  // five occurrences of it.
  .restated('c7', 6);

export const fixture14Graph = b.build();
export const fixture14Spans = b.spanIds;
