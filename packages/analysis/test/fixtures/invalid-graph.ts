import { localId } from '@make-your-case/domain';
import { graph } from './builder.ts';
import { atom } from './formula.ts';

/**
 * A graph that breaks several validation rules at once (AGENTS.md section 7.5).
 *
 * Built through `patch` because the builder deliberately performs no validation
 * or repair — a fixture that could not express a broken graph would be useless
 * for testing the validator.
 *
 * Breaks, in order: two theses; a stated claim with no occurrence; an inferred
 * claim that has one; an inference with no premises; a conclusion listed among
 * its own premises; a duplicate premise; a duplicate route; an author inference
 * drawing on an opposing claim; a relation with two targets; a relation
 * attacking its own side; a formalization binding an atom to an unrelated
 * claim; and a dangling reference.
 */
const b = graph()
  .thesis('c1', 'The first thesis', { kind: 'normative' })
  .claim('c2', 'A premise')
  .claim('c3', 'Another premise')
  // Stated but with no occurrence: it cannot be traced to the text.
  .claim('c4', 'A stated claim with nothing anchoring it', { withoutOccurrence: true })
  .inferred('c5', 'An inferred claim')
  .opposing('c6', "The opponent's claim")
  .infer('i1', ['c2', 'c3'], 'c1')
  // Same conclusion, same premises: a duplicate route, not an alternative one.
  .infer('i2', ['c2', 'c3'], 'c1')
  .infer('i3', ['c2'], 'c3', { scheme: 'deductive' })
  .formalize('i3', {
    // 'X' is bound to c1, which is neither a premise nor the conclusion here.
    atoms: { P: 'c2', Q: 'c3', X: 'c1' },
    premises: [atom('P')],
    conclusion: atom('Q'),
  })
  .patch((draft) => {
    // A second thesis.
    const second = draft.claims.find((c) => c.id === localId('c3'));
    if (second !== undefined) {
      draft.claims[draft.claims.indexOf(second)] = { ...second, is_thesis: true };
    }

    // An inferred claim with an occurrence, which contradicts what inferred means.
    draft.occurrences.push({
      claim_id: localId('c5'),
      span_id: localId('s1'),
      surface_text: 'something the author never wrote',
    });

    // An inference with no premises at all.
    draft.inferences.push({
      id: localId('i4'),
      conclusion_claim_id: localId('c1'),
      scheme: 'causal',
      origin: 'stated',
      attribution: 'author',
      formalization: null,
      confidence: 1,
    });

    // A step that concludes one of its own premises, with that premise twice over.
    draft.inferences.push({
      id: localId('i5'),
      conclusion_claim_id: localId('c2'),
      scheme: 'causal',
      origin: 'stated',
      attribution: 'author',
      formalization: null,
      confidence: 1,
    });
    draft.premises.push({ inference_id: localId('i5'), claim_id: localId('c2'), origin: 'stated' });
    draft.premises.push({ inference_id: localId('i5'), claim_id: localId('c2'), origin: 'stated' });

    // An author inference reaching into the opponent's material.
    draft.inferences.push({
      id: localId('i6'),
      conclusion_claim_id: localId('c1'),
      scheme: 'causal',
      origin: 'stated',
      attribution: 'author',
      formalization: null,
      confidence: 1,
    });
    draft.premises.push({ inference_id: localId('i6'), claim_id: localId('c6'), origin: 'stated' });

    // A relation pointing at both a claim and an inference.
    draft.relations.push({
      id: localId('r1'),
      type: 'rebut',
      source_claim_id: localId('c6'),
      target_claim_id: localId('c1'),
      target_inference_id: localId('i1'),
    });

    // An author claim rebutting another author claim.
    draft.relations.push({
      id: localId('r2'),
      type: 'rebut',
      source_claim_id: localId('c2'),
      target_claim_id: localId('c1'),
      target_inference_id: null,
    });

    // A premise pointing at a claim that does not exist.
    draft.premises.push({ inference_id: localId('i1'), claim_id: localId('c99'), origin: 'stated' });
  });

export const invalidGraph = b.build();
export const invalidGraphSpans = b.spanIds;
