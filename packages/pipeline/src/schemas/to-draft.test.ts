import { validateArgumentGraph } from '@make-your-case/analysis';
import { localId } from '@make-your-case/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { reconstructResponseToDraft } from './to-draft.ts';
import { reconstructResponseSchema, type ReconstructResponse } from './wire.ts';

type WireClaim = ReconstructResponse['claims'][number];
type WireInference = ReconstructResponse['inferences'][number];

function claim(overrides: Partial<WireClaim> & Pick<WireClaim, 'id' | 'text'>): WireClaim {
  return {
    kind: 'factual',
    modality: 'asserted',
    origin: 'stated',
    attribution: 'author',
    citation: null,
    confidence: 0.9,
    is_thesis: false,
    occurrences: [],
    ...overrides,
  };
}

const baseInference: WireInference = {
  id: 'i1',
  premise_ids: ['c1', 'c2', 'c4'],
  conclusion_id: 'c3',
  scheme: 'deductive',
  origin: 'stated',
  attribution: 'author',
  confidence: 0.8,
  formalization: null,
};

// Fixture 05 in wire form: rule + fact + inferred bridge premise -> thesis.
const fixture05: ReconstructResponse = {
  claims: [
    claim({
      id: 'c1',
      text: 'Notice of termination must be given in writing',
      kind: 'legal_rule',
      occurrences: [{ span_id: 's1', surface_text: 'notice must be in writing' }],
    }),
    claim({
      id: 'c2',
      text: 'The tenant gave notice by email',
      occurrences: [{ span_id: 's2', surface_text: 'notice by email' }],
    }),
    claim({
      id: 'c3',
      text: 'The tenant gave valid notice',
      kind: 'normative',
      is_thesis: true,
      occurrences: [{ span_id: 's3', surface_text: 'notice was valid' }],
    }),
    claim({
      id: 'c4',
      text: 'An email satisfies the written-notice requirement',
      kind: 'legal_rule',
      origin: 'inferred',
    }),
  ],
  inferences: [baseInference],
  relations: [],
};

const spans = ['s1', 's2', 's3'].map(localId);

describe('reconstructResponseToDraft', () => {
  it('flattens a response into a draft that validates', () => {
    const { draft, issues } = reconstructResponseToDraft(fixture05);

    expect(issues).toEqual([]);
    expect(draft.occurrences).toHaveLength(3);
    expect(draft.premises.map((premise) => [premise.claim_id, premise.origin])).toEqual([
      ['c1', 'stated'],
      ['c2', 'stated'],
      ['c4', 'inferred'],
    ]);
    expect(validateArgumentGraph(draft, spans).ok).toBe(true);
  });

  it('builds a formalization from its node list', () => {
    const inference: WireInference = {
      ...baseInference,
      premise_ids: ['c1', 'c2'],
      formalization: {
        atoms: [
          { name: 'P', claim_id: 'c2' },
          { name: 'Q', claim_id: 'c3' },
        ],
        nodes: [
          { id: 'f1', op: 'atom', atom: 'P', args: [] },
          { id: 'f2', op: 'atom', atom: 'Q', args: [] },
          { id: 'f3', op: 'implies', atom: null, args: ['f1', 'f2'] },
        ],
        premise_roots: ['f3', 'f1'],
        conclusion_root: 'f2',
      },
    };
    const { draft, issues } = reconstructResponseToDraft({ ...fixture05, inferences: [inference] });

    expect(issues).toEqual([]);
    expect(draft.inferences[0]?.formalization).toEqual({
      atoms: { P: 'c2', Q: 'c3' },
      premises: [{ implies: [{ atom: 'P' }, { atom: 'Q' }] }, { atom: 'P' }],
      conclusion: { atom: 'Q' },
    });
  });

  it('reports an unbuildable formalization as an issue naming the inference', () => {
    const inference: WireInference = {
      ...baseInference,
      formalization: { atoms: [], nodes: [], premise_roots: ['f1'], conclusion_root: 'f2' },
    };
    const { draft, issues } = reconstructResponseToDraft({ ...fixture05, inferences: [inference] });

    expect(draft.inferences[0]?.formalization).toBeNull();
    expect(issues).toEqual([
      {
        rule: 'formalization-encoding',
        message: 'Inference i1: formula node "f1" does not exist.',
        refs: ['i1'],
      },
    ]);
  });

  it('reports a formalization whose conclusion is linked to no premise', () => {
    const inference: WireInference = {
      ...baseInference,
      formalization: {
        atoms: [
          { name: 'P', claim_id: 'c1' },
          { name: 'Q', claim_id: 'c2' },
          { name: 'S', claim_id: 'c4' },
          { name: 'R', claim_id: 'c3' },
        ],
        nodes: [
          { id: 'f1', op: 'atom', atom: 'P', args: [] },
          { id: 'f2', op: 'atom', atom: 'Q', args: [] },
          { id: 'f3', op: 'atom', atom: 'S', args: [] },
          { id: 'f4', op: 'atom', atom: 'R', args: [] },
        ],
        premise_roots: ['f1', 'f2', 'f3'],
        conclusion_root: 'f4',
      },
    };
    const { draft, issues } = reconstructResponseToDraft({ ...fixture05, inferences: [inference] });

    expect(draft.inferences[0]?.formalization).toBeNull();
    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringMatching(/^Inference i1: the conclusion's atom "R" appears in no premise/),
    ]);
  });

  it('leaves malformed IDs for validation to report back to the model', () => {
    const response = {
      ...fixture05,
      claims: fixture05.claims.map((c) => (c.id === 'c4' ? { ...c, id: 'C4' } : c)),
    };
    const result = validateArgumentGraph(reconstructResponseToDraft(response).draft, spans);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.rule)).toContain('schema');
  });
});

describe('reconstructResponseSchema', () => {
  it('compiles to a JSON schema with no recursive references', () => {
    const json = JSON.stringify(z.toJSONSchema(reconstructResponseSchema));

    expect(json).not.toContain('$ref');
    expect(json.length).toBeLessThan(20_000);
  });
});
