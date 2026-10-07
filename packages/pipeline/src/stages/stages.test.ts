import { localId, type ArgumentGraphDraft } from '@make-your-case/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyPrompt,
  extractPrompt,
  GUARDRAILS,
  reconstructPrompt,
  summarizePrompt,
} from '../prompts/index.ts';
import type { ExtractResponse, ReconstructResponse } from '../schemas/wire.ts';
import { FakeModelProvider } from '../testing/fake-model-provider.ts';
import { classifySpans } from './classify.ts';
import { extractArgument } from './extract.ts';
import { countArgumentative, passesGate } from './gate.ts';
import { checkPreservation } from './preservation.ts';
import { retryFeedback } from './feedback.ts';
import { reconstructArgument } from './reconstruct.ts';
import { segmentDocument } from './segment.ts';
import { summarizeNonArgument } from './summarize.ts';

const source = [
  '# Argument',
  '',
  '1. Notice must be in writing. The tenant emailed notice.',
  '2. So the notice was valid.',
  '',
  'We ask the court to deny the motion.',
].join('\n');
const spans = segmentDocument(source);

describe('classifySpans', () => {
  it('labels spans batch by batch, with neighbouring context, reporting progress', async () => {
    const fake = new FakeModelProvider({
      classify: [
        {
          labels: [
            { span_id: 's1', function: 'descriptive', confidence: 0.9 },
            { span_id: 's2', function: 'argumentative', confidence: 0.8 },
            { span_id: 's9', function: 'argumentative', confidence: 1 }, // not in this batch: ignored
          ],
        },
        { labels: [{ span_id: 's4', function: 'argumentative', confidence: 1.7 }] }, // s3 skipped
        { labels: [{ span_id: 's5', function: 'argumentative', confidence: 0.6 }] },
      ],
    });
    const onProgress = vi.fn();

    const labelled = await classifySpans(spans, fake.getChatModel('classify'), {
      batchSize: 2,
      onProgress,
    });

    expect(labelled.map(({ span }) => [span.id, span.function, span.function_confidence])).toEqual([
      ['s1', 'descriptive', 0.9],
      ['s2', 'argumentative', 0.8],
      ['s3', 'unclassified', null],
      ['s4', 'argumentative', 1],
      ['s5', 'argumentative', 0.6],
    ]);
    expect(onProgress.mock.calls).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ]);
    const second = fake.callsFor('classify')[1]?.text ?? '';
    expect(second).toContain(
      'Context before (do not label):\n[s1] # Argument\n[s2] 1. Notice must be in writing.',
    );
    expect(second).toContain(
      'Spans to label:\n[s3] The tenant emailed notice.\n[s4] 2. So the notice was valid.',
    );
    expect(second).toContain(
      'Context after (do not label):\n[s5] We ask the court to deny the motion.',
    );
  });
});

describe('gate', () => {
  const labelled = spans.map((segmented, index) => ({
    ...segmented,
    span: {
      ...segmented.span,
      function: index < 3 ? ('argumentative' as const) : ('narrative' as const),
      function_confidence: index === 0 ? 0.3 : 0.9,
    },
  }));

  it('counts only confidently argumentative spans', () => {
    expect(countArgumentative(labelled)).toBe(2);
    expect(passesGate(labelled, 2)).toBe(true);
    expect(passesGate(labelled, 3)).toBe(false);
  });
});

describe('summarizeNonArgument', () => {
  it('returns the trimmed summary', async () => {
    const fake = new FakeModelProvider({ classify: [{ summary: '  A recipe.  ' }] });
    await expect(summarizeNonArgument(spans, fake.getChatModel('classify'))).resolves.toBe(
      'A recipe.',
    );
  });
});

describe('extractArgument', () => {
  it('sends the whole document with labels, headings and list markers', async () => {
    const extracted: ExtractResponse = { claims: [], inferences: [], relations: [] };
    const fake = new FakeModelProvider({ extract: [extracted] });

    await expect(extractArgument(spans, fake.getChatModel('extract'))).resolves.toEqual(extracted);
    expect(fake.calls[0]?.text).toContain(
      '[s1] (unclassified) # Argument\n[s2] (unclassified) 1. Notice must be in writing.',
    );
    expect(fake.calls[0]?.text).toContain(
      '[s5] (unclassified) We ask the court to deny the motion.',
    );
  });
});

const extracted: ExtractResponse = {
  claims: [
    {
      id: 'c1',
      text: 'Notice must be in writing',
      attribution: 'author',
      citation: 'Lease § 22',
      is_thesis: false,
      occurrences: [{ span_id: 's2', surface_text: 'Notice must be in writing' }],
    },
    {
      id: 'c2',
      text: 'The tenant emailed notice',
      attribution: 'author',
      citation: null,
      is_thesis: false,
      occurrences: [{ span_id: 's3', surface_text: 'The tenant emailed notice' }],
    },
  ],
  inferences: [],
  relations: [],
};

describe('reconstructArgument', () => {
  const response: ReconstructResponse = { claims: [], inferences: [], relations: [] };

  it('feeds the previous attempt and its errors back on a retry', async () => {
    const fake = new FakeModelProvider({ reconstruct: [response, response] });
    const model = fake.getChatModel('reconstruct');

    await reconstructArgument({ spans, extracted, retry: null }, model);
    await reconstructArgument(
      { spans, extracted, retry: { previous: response, errors: ['Claim c9 does not exist.'] } },
      model,
    );

    const [first, second] = fake.callsFor('reconstruct');
    expect(first?.text).toContain('"Notice must be in writing"');
    expect(first?.text).not.toContain('previous reconstruction');
    expect(second?.text).toContain(
      'Your previous reconstruction (JSON):\n{"claims":[],"inferences":[],"relations":[]}',
    );
    expect(second?.text).toContain('- Claim c9 does not exist.');
  });
});

describe('checkPreservation', () => {
  const draftWith = (
    claims: {
      id: string;
      attribution?: 'author' | 'opposing';
      citation?: string | null;
      spans: string[];
    }[],
  ): ArgumentGraphDraft => ({
    claims: claims.map((claim) => ({
      id: localId(claim.id),
      canonical_text: claim.id,
      kind: 'factual',
      modality: 'asserted',
      origin: 'stated',
      attribution: claim.attribution ?? 'author',
      citation: claim.citation ?? null,
      confidence: 1,
      is_thesis: false,
    })),
    occurrences: claims.flatMap((claim) =>
      claim.spans.map((span) => ({
        claim_id: localId(claim.id),
        span_id: localId(span),
        surface_text: 'x',
      })),
    ),
    inferences: [],
    premises: [],
    relations: [],
    findings: [],
  });

  it('accepts merged, renamed claims that keep every occurrence and citation', () => {
    expect(
      checkPreservation(
        extracted,
        draftWith([{ id: 'c7', citation: 'Lease § 22', spans: ['s2', 's3'] }]),
      ),
    ).toEqual([]);
  });

  it('reports a dropped occurrence', () => {
    const issues = checkPreservation(
      extracted,
      draftWith([{ id: 'c1', citation: 'Lease § 22', spans: ['s2'] }]),
    );
    expect(issues.map((issue) => [issue.rule, issue.refs])).toEqual([
      ['preservation', ['c2', 's3']],
    ]);
  });

  it('reports a changed attribution', () => {
    const issues = checkPreservation(
      extracted,
      draftWith([
        { id: 'c1', citation: 'Lease § 22', spans: ['s2'] },
        { id: 'c2', attribution: 'opposing', spans: ['s3'] },
      ]),
    );
    expect(issues.map((issue) => issue.refs)).toEqual([['c2', 's3']]);
  });

  it('reports a lost citation', () => {
    const issues = checkPreservation(extracted, draftWith([{ id: 'c1', spans: ['s2', 's3'] }]));
    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringMatching(/cites "Lease § 22"/),
    ]);
  });
});

describe('prompts', () => {
  it.each([classifyPrompt, summarizePrompt, extractPrompt, reconstructPrompt])(
    '$id states the guardrails',
    (prompt) => {
      expect(prompt.system).toContain(GUARDRAILS);
    },
  );

  it('carries every reconstruction-policy rule (AGENTS.md section 8.3)', () => {
    for (const rule of [
      'Add a premise only to complete a step that is genuinely incomplete',
      'Never add a premise to a step whose premises the author fully stated',
      'Never repair stated reasoning',
      'Preserve circular structure',
      'Merge true restatements only',
      'Preserve modality exactly',
      'Keep attribution',
      'Represent alternative routes',
    ]) {
      expect(reconstructPrompt.system).toContain(rule);
    }
  });
});

describe('retryFeedback', () => {
  it('adds hints for known model errors and drops duplicates', () => {
    const arity = {
      rule: 'formalization-arity',
      message: 'Inference i1 has 1 premise(s) but 2 premise formula(s).',
      refs: [],
    };
    const other = { rule: 'thesis', message: 'There is no thesis.', refs: [] };

    expect(retryFeedback([arity, other, other])).toEqual([
      expect.stringMatching(
        /^Inference i1 has 1 premise\(s\) but 2 premise formula\(s\)\. An extra formula usually means/,
      ),
      'There is no thesis.',
    ]);
  });
});
