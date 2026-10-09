import { describe, expect, it } from 'vitest';
import type { AnalysisFinding, ArgumentGraphView } from '@make-your-case/domain';
import { renderGraph } from '../src/render.ts';

const graph: ArgumentGraphView<string> = {
  claims: [
    {
      id: 'c1',
      canonical_text: 'Notice was timely',
      kind: 'normative',
      modality: 'asserted',
      origin: 'stated',
      attribution: 'author',
      citation: null,
      confidence: 1,
      is_thesis: true,
    },
    {
      id: 'c2',
      canonical_text: 'Section 9 requires written notice within 30 days',
      kind: 'legal_rule',
      modality: 'asserted',
      origin: 'stated',
      attribution: 'author',
      citation: 'Agreement § 9',
      confidence: 1,
      is_thesis: false,
    },
    {
      id: 'c3',
      canonical_text: 'An email satisfies the written-notice requirement',
      kind: 'definitional',
      modality: 'probable',
      origin: 'inferred',
      attribution: 'author',
      citation: null,
      confidence: 0.6,
      is_thesis: false,
    },
    {
      id: 'c4',
      canonical_text: 'Notice had to be sent by certified mail',
      kind: 'legal_rule',
      modality: 'asserted',
      origin: 'stated',
      attribution: 'opposing',
      citation: null,
      confidence: 1,
      is_thesis: false,
    },
  ],
  occurrences: [
    { claim_id: 'c1', span_id: 's1', surface_text: 'notice was timely' },
    { claim_id: 'c2', span_id: 's2', surface_text: 'Section 9 requires' },
    { claim_id: 'c2', span_id: 's5', surface_text: 'the notice requirement' },
  ],
  inferences: [
    {
      id: 'i1',
      conclusion_claim_id: 'c1',
      premises: [
        { claim_id: 'c2', origin: 'stated' },
        { claim_id: 'c3', origin: 'inferred' },
      ],
      scheme: 'deductive',
      origin: 'stated',
      attribution: 'author',
      formalization: null,
      confidence: 1,
    },
  ],
  relations: [
    {
      id: 'r1',
      type: 'rebut',
      source_claim_id: 'c4',
      target_claim_id: 'c1',
      target_inference_id: null,
    },
  ],
};

const findings: readonly AnalysisFinding<string>[] = [
  {
    kind: 'load_bearing',
    severity: 'info',
    explanation: 'Without the rule nothing supports the conclusion.',
    produced_by: 'load-bearing@1.0.0',
    targets: [{ target: 'claim', claim_id: 'c2', ordinal: 0 }],
  },
  {
    kind: 'implicit_premise',
    severity: 'critical',
    explanation: 'The step relies on a premise the text does not state.',
    produced_by: 'implicit-premise@1.0.0',
    targets: [
      { target: 'claim', claim_id: 'c3', ordinal: 0 },
      { target: 'inference', inference_id: 'i1', ordinal: 1 },
    ],
  },
];

describe('renderGraph', () => {
  const text = renderGraph(graph, findings);

  it('leads with the thesis', () => {
    expect(text.startsWith('THESIS: Notice was timely')).toBe(true);
  });

  it('marks inferred content unmistakably', () => {
    // Section 1: inferred content must be distinguished at every layer, and a
    // prompt is a layer — a judge must not read it as something the author wrote.
    expect(text).toContain('INFERRED');
    const inferredLine = text.split('\n').find((line) => line.includes('c3'));
    expect(inferredLine).toContain('INFERRED');
  });

  it('shows the attributes the answer keys talk about', () => {
    expect(text).toContain('cited: Agreement § 9');
    expect(text).toContain('no citation');
    expect(text).toContain('probable');
    expect(text).toContain('opposing');
    expect(text).toContain('legal_rule');
  });

  it('shows how often a claim was stated', () => {
    expect(text).toMatch(/c2.*stated 2×/s);
  });

  it('renders inferences as premises arrow conclusion', () => {
    expect(text).toContain('[i1] c2 + c3 -> c1');
  });

  it('renders relations with their type', () => {
    expect(text).toContain('c4 --rebut--> c1');
  });

  it('orders findings by severity, most severe first', () => {
    const critical = text.indexOf('implicit_premise (critical)');
    const info = text.indexOf('load_bearing (info)');
    expect(critical).toBeGreaterThan(-1);
    expect(critical).toBeLessThan(info);
  });

  it('is deterministic', () => {
    expect(renderGraph(graph, findings)).toBe(text);
  });

  it('says so plainly when a section is empty', () => {
    const bare = renderGraph({ claims: [], occurrences: [], inferences: [], relations: [] }, []);
    expect(bare).toContain('THESIS: (none)');
    expect(bare.match(/\(none\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
