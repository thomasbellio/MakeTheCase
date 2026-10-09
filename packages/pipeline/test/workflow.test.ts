import { MemorySaver } from '@langchain/langgraph';
import { createInMemoryRepositories } from '@make-your-case/domain/testing';
import { describe, expect, it } from 'vitest';
import type { ExtractResponse, ReconstructResponse } from '../src/schemas/wire.ts';
import { FakeModelProvider, RecordingProgressReporter } from '../src/testing/index.ts';
import { createAnalysisWorkflow, runAnalysis, type WorkflowConfig } from '../src/workflow/index.ts';

const SOURCE = [
  '# Notice',
  '',
  'Notice must be given in writing. The tenant sent written notice. So the notice was valid.',
  '',
  'The lease began in May.',
].join('\n');
// Spans: s1 heading, s2 rule, s3 fact, s4 conclusion, s5 background.

const classified = (fn: 'argumentative' | 'narrative') => ({
  labels: ['s1', 's2', 's3', 's4', 's5'].map((span_id) => ({
    span_id,
    function: fn,
    confidence: 0.9,
  })),
});

const extracted: ExtractResponse = {
  claims: [
    {
      id: 'c1',
      text: 'Notice must be given in writing',
      attribution: 'author',
      citation: 'Lease § 22',
      is_thesis: false,
      occurrences: [{ span_id: 's2', surface_text: 'Notice must be given in writing' }],
    },
    {
      id: 'c2',
      text: 'The tenant sent written notice',
      attribution: 'author',
      citation: 'Ex. 2',
      is_thesis: false,
      occurrences: [{ span_id: 's3', surface_text: 'The tenant sent written notice' }],
    },
    {
      id: 'c3',
      text: 'The notice was valid',
      attribution: 'author',
      citation: null,
      is_thesis: true,
      occurrences: [{ span_id: 's4', surface_text: 'So the notice was valid' }],
    },
  ],
  inferences: [{ id: 'i1', premise_ids: ['c1', 'c2'], conclusion_id: 'c3', attribution: 'author' }],
  relations: [],
};

type WireClaim = ReconstructResponse['claims'][number];
const reconstructClaim = (
  claim: ExtractResponse['claims'][number],
  kind: WireClaim['kind'],
): WireClaim => ({
  ...claim,
  kind,
  modality: 'asserted',
  origin: 'stated',
  confidence: 0.9,
});

/** The extracted claim at `index`, or a loud failure if the fixture changed. */
function extractedClaim(index: number): ExtractResponse['claims'][number] {
  const claim = extracted.claims[index];
  if (claim === undefined) throw new Error(`the extract fixture has no claim ${String(index)}`);
  return claim;
}

const valid: ReconstructResponse = {
  claims: [
    reconstructClaim(extractedClaim(0), 'legal_rule'),
    reconstructClaim(extractedClaim(1), 'factual'),
    reconstructClaim(extractedClaim(2), 'normative'),
  ],
  inferences: [
    {
      id: 'i1',
      premise_ids: ['c1', 'c2'],
      conclusion_id: 'c3',
      scheme: 'deductive',
      origin: 'stated',
      attribution: 'author',
      confidence: 0.9,
      formalization: null,
    },
  ],
  relations: [],
};

/** No thesis: a validation error. */
const invalid: ReconstructResponse = {
  ...valid,
  claims: valid.claims.map((claim) => ({ ...claim, is_thesis: false })),
};

/** Adds background the argument never uses: a warning, never an error. */
const withBackground: ReconstructResponse = {
  ...valid,
  claims: [
    ...valid.claims,
    {
      id: 'c4',
      text: 'The lease began in May',
      kind: 'factual',
      modality: 'asserted',
      origin: 'stated',
      attribution: 'author',
      citation: null,
      confidence: 0.9,
      is_thesis: false,
      occurrences: [{ span_id: 's5', surface_text: 'The lease began in May' }],
    },
  ],
};

async function setup(
  script: ConstructorParameters<typeof FakeModelProvider>[0],
  config: Partial<WorkflowConfig> = {},
) {
  const repositories = createInMemoryRepositories();
  const document = await repositories.documents.create({
    source_text: SOURCE,
    title: null,
    role: 'own_brief',
  });
  const run = await repositories.runs.create({ document_id: document.id, status: 'running' });
  const models = new FakeModelProvider(script);
  const reporter = new RecordingProgressReporter();
  const workflow = createAnalysisWorkflow({
    models,
    reporter,
    revisions: repositories.revisions,
    config: { maxValidationRetries: 3, gateMinArgumentativeSpans: 2, ...config },
    checkpointer: new MemorySaver(),
  });
  const input = { runId: run.id, documentId: document.id, sourceText: SOURCE };
  return { repositories, models, reporter, workflow, input };
}

describe('analysis workflow', () => {
  it('runs every stage and persists the analyzed graph', async () => {
    const { repositories, models, reporter, workflow, input } = await setup({
      classify: [classified('argumentative')],
      extract: [extracted],
      reconstruct: [valid],
    });

    const outcome = await runAnalysis(workflow, input);

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(reporter.completedStages()).toEqual([
      'segment',
      'classify',
      'extract',
      'reconstruct',
      'validate',
      'analyze',
      'persist',
    ]);
    expect((await repositories.runs.getById(input.runId))?.revision_id).toBe(outcome.revisionId);

    const graph = await repositories.revisions.getArgumentGraph(outcome.revisionId);
    expect(graph?.claims).toHaveLength(3);
    expect(graph?.findings.map((finding) => finding.kind)).toContain('unchecked_step');
    const spans = await repositories.spans.listByDocument(input.documentId);
    expect(spans.map((span) => span.function)).toEqual(Array(5).fill('argumentative'));
    expect(models.remaining('reconstruct')).toBe(0);
  });

  it('reports classification progress with counts only', async () => {
    const { reporter, workflow, input } = await setup({
      classify: [classified('argumentative')],
      extract: [extracted],
      reconstruct: [valid],
    });

    await runAnalysis(workflow, input);

    expect(reporter.events).toContainEqual({
      type: 'stage_progress',
      stage: 'classify',
      message: 'Classified 5 of 5 spans',
      data: { classified: 5, total: 5 },
    });
  });

  it('ends a non-argument at the gate with a summary and no revision', async () => {
    const { repositories, models, workflow, input } = await setup({
      classify: [classified('narrative'), { summary: 'A short account of a lease.' }],
    });

    const outcome = await runAnalysis(workflow, input);

    expect(outcome).toEqual({ status: 'not_an_argument', summary: 'A short account of a lease.' });
    expect(models.callsFor('extract')).toHaveLength(0);
    expect((await repositories.runs.getById(input.runId))?.revision_id).toBeNull();
  });

  it('feeds validation errors back to reconstruct and recovers', async () => {
    const { models, reporter, workflow, input } = await setup({
      classify: [classified('argumentative')],
      extract: [extracted],
      reconstruct: [invalid, valid],
    });

    const outcome = await runAnalysis(workflow, input);

    expect(outcome.status).toBe('completed');
    const [, second] = models.callsFor('reconstruct');
    expect(second?.text).toContain('Your previous reconstruction (JSON)');
    expect(second?.text).toMatch(/thesis/i);
    expect(reporter.events).toContainEqual({
      type: 'validation_retry',
      attempt: 1,
      errorCount: expect.any(Number) as number,
    });
  });

  it('fails the run when validation still fails after the last retry', async () => {
    const { repositories, models, reporter, workflow, input } = await setup(
      {
        classify: [classified('argumentative')],
        extract: [extracted],
        reconstruct: [invalid, invalid],
      },
      { maxValidationRetries: 1 },
    );

    const outcome = await runAnalysis(workflow, input);

    expect(outcome).toEqual({
      status: 'failed',
      message: 'The argument could not be reconstructed into a valid structure after 2 attempts.',
    });
    expect(models.callsFor('reconstruct')).toHaveLength(2);
    expect(reporter.events.filter((event) => event.type === 'validation_retry')).toHaveLength(1);
    expect(reporter.events.at(-1)).toEqual({
      type: 'run_failed',
      message: expect.stringMatching(/2 attempts/) as string,
    });
    expect(reporter.completedStages()).not.toContain('persist');
    expect((await repositories.runs.getById(input.runId))?.revision_id).toBeNull();
  });

  it('warns about unconnected claims without retrying', async () => {
    const { repositories, models, workflow, input } = await setup({
      classify: [classified('argumentative')],
      extract: [extracted],
      reconstruct: [withBackground],
    });

    const outcome = await runAnalysis(workflow, input);

    expect(outcome.status).toBe('completed');
    expect(models.callsFor('reconstruct')).toHaveLength(1);
    if (outcome.status !== 'completed') return;
    const graph = await repositories.revisions.getArgumentGraph(outcome.revisionId);
    expect(graph?.findings.map((finding) => finding.kind)).toContain('unconnected_claim');
  });

  it('resumes from the last checkpoint after a failure, without repeating finished stages', async () => {
    const { models, workflow, input } = await setup({
      classify: [classified('argumentative')],
      extract: [new Error('provider unavailable'), extracted],
      reconstruct: [valid],
    });

    await expect(runAnalysis(workflow, input)).rejects.toThrow('provider unavailable');
    const outcome = await runAnalysis(workflow, input);

    expect(outcome.status).toBe('completed');
    expect(models.callsFor('classify')).toHaveLength(1);
    expect(models.callsFor('extract')).toHaveLength(2);
  });

  it('returns the recorded outcome for a run that already finished', async () => {
    const { models, workflow, input } = await setup({
      classify: [classified('argumentative')],
      extract: [extracted],
      reconstruct: [valid],
    });

    const first = await runAnalysis(workflow, input);
    const second = await runAnalysis(workflow, input);

    expect(second).toEqual(first);
    expect(models.calls).toHaveLength(3);
  });
});
