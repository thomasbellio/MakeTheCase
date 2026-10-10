/**
 * Writes one demo analysis into DATABASE_URL, with no model call (AGENTS.md
 * section 12), so the UI can be explored and checked without a billed run.
 *
 *   pnpm --filter @make-your-case/web seed:demo          # a completed analysis
 *   pnpm --filter @make-your-case/web seed:demo --live   # the same, but the run's
 *                                                        # events arrive over ~10 s,
 *                                                        # for watching live progress
 *
 * The argument is hand-built — a rule, an uncited fact and an inferred premise
 * jointly concluding the thesis, an opposing claim undercutting that step, and
 * an unconnected background claim — so every visual state in section 9.3 is
 * reachable. Its findings are written by hand in the analyzers' output shape:
 * `apps/web` may not import `analysis` (section 4), so they cannot be computed
 * here. This is a development aid, not a source of truth about the analyzers.
 */
import {
  localId,
  type AnalysisFinding,
  type ArgumentGraphDraft,
  type DraftSpan,
  type LocalId,
  type NewRunEvent,
  type RunId,
} from '@make-your-case/domain';
import { createDb, createRepositories } from '@make-your-case/persistence';
import { serverEnv } from '../env.ts';

const SENTENCES = [
  { text: 'Notice of Renewal', heading: true, fn: 'unclassified' },
  { text: 'The standard of review is de novo.', heading: false, fn: 'descriptive' },
  {
    text: 'The lease requires the tenant to give written notice of renewal by June 1 (Lease § 12).',
    heading: false,
    fn: 'argumentative',
  },
  { text: 'The tenant emailed the landlord on May 20.', heading: false, fn: 'narrative' },
  {
    text: 'The landlord argues that an email is not written notice.',
    heading: false,
    fn: 'argumentative',
  },
  {
    text: 'The tenant therefore renewed the lease, and the eviction should be dismissed.',
    heading: false,
    fn: 'argumentative',
  },
] as const;

const id = (value: string): LocalId => localId(value);

function buildDocument(): { sourceText: string; spans: DraftSpan[] } {
  let sourceText = '';
  const spans = SENTENCES.map((sentence, ordinal): DraftSpan => {
    if (ordinal > 0) sourceText += '\n\n';
    if (sentence.heading) sourceText += '# ';
    const charStart = sourceText.length;
    sourceText += sentence.text;
    return {
      id: id(`s${String(ordinal)}`),
      ordinal,
      char_start: charStart,
      char_end: sourceText.length,
      is_heading: sentence.heading,
      function: sentence.fn,
      function_confidence: 0.9,
    };
  });
  return { sourceText, spans };
}

const claim = (
  local: string,
  fields: Partial<ArgumentGraphDraft['claims'][number]> &
    Pick<ArgumentGraphDraft['claims'][number], 'canonical_text'>,
): ArgumentGraphDraft['claims'][number] => ({
  id: id(local),
  kind: 'factual',
  modality: 'asserted',
  origin: 'stated',
  attribution: 'author',
  citation: null,
  confidence: 0.9,
  is_thesis: false,
  ...fields,
});

const draft: ArgumentGraphDraft = {
  claims: [
    claim('c1', { canonical_text: 'The standard of review is de novo.', kind: 'legal_rule' }),
    claim('c2', {
      canonical_text: 'A tenant must give written notice of renewal by June 1.',
      kind: 'legal_rule',
      citation: 'Lease § 12',
    }),
    claim('c3', { canonical_text: 'The tenant emailed the landlord on May 20.' }),
    claim('c4', {
      canonical_text: 'An email is not written notice.',
      kind: 'definitional',
      attribution: 'opposing',
    }),
    claim('c5', { canonical_text: 'The tenant renewed the lease.', kind: 'normative' }),
    claim('c6', {
      canonical_text: 'The eviction should be dismissed.',
      kind: 'normative',
      is_thesis: true,
    }),
    claim('c7', {
      canonical_text: 'An email satisfies the written-notice requirement.',
      kind: 'definitional',
      origin: 'inferred',
      confidence: 0.7,
    }),
  ],
  occurrences: [
    { claim_id: id('c1'), span_id: id('s1'), surface_text: SENTENCES[1].text },
    { claim_id: id('c2'), span_id: id('s2'), surface_text: SENTENCES[2].text },
    { claim_id: id('c3'), span_id: id('s3'), surface_text: SENTENCES[3].text },
    { claim_id: id('c4'), span_id: id('s4'), surface_text: 'an email is not written notice' },
    {
      claim_id: id('c5'),
      span_id: id('s5'),
      surface_text: 'The tenant therefore renewed the lease',
    },
    { claim_id: id('c6'), span_id: id('s5'), surface_text: 'the eviction should be dismissed' },
  ],
  inferences: [
    {
      id: id('i1'),
      conclusion_claim_id: id('c5'),
      formalization: null,
      scheme: 'deductive',
      origin: 'stated',
      attribution: 'author',
      confidence: 0.85,
    },
    {
      id: id('i2'),
      conclusion_claim_id: id('c6'),
      formalization: null,
      scheme: 'deductive',
      origin: 'stated',
      attribution: 'author',
      confidence: 0.8,
    },
  ],
  premises: [
    { inference_id: id('i1'), claim_id: id('c2'), origin: 'stated' },
    { inference_id: id('i1'), claim_id: id('c3'), origin: 'stated' },
    { inference_id: id('i1'), claim_id: id('c7'), origin: 'inferred' },
    { inference_id: id('i2'), claim_id: id('c5'), origin: 'stated' },
  ],
  relations: [
    {
      id: id('r1'),
      source_claim_id: id('c4'),
      target_claim_id: null,
      target_inference_id: id('i1'),
      type: 'undercut',
    },
  ],
  findings: [],
};

const onClaim = (local: string) => [{ target: 'claim' as const, claim_id: id(local), ordinal: 0 }];
const onInference = (local: string) => [
  { target: 'inference' as const, inference_id: id(local), ordinal: 0 },
];

const findings: AnalysisFinding<LocalId>[] = [
  {
    kind: 'implicit_premise',
    severity: 'critical',
    produced_by: 'implicit-premise@1.0.0',
    explanation:
      'The step to “The tenant renewed the lease.” depends on a premise the text does not state: “An email satisfies the written-notice requirement.” The conclusion holds only if it does.',
    targets: onClaim('c7'),
  },
  {
    kind: 'unsupported_claim',
    severity: 'warning',
    produced_by: 'unsupported-claim@1.0.0',
    explanation:
      '“The tenant emailed the landlord on May 20.” is a fact the thesis depends on, and the text offers no citation for it.',
    targets: onClaim('c3'),
  },
  ...['c2', 'c3', 'c5', 'c7'].map((local): AnalysisFinding<LocalId> => ({
    kind: 'load_bearing',
    severity: 'info',
    produced_by: 'load-bearing@1.0.0',
    explanation: `Without “${draft.claims.find((c) => c.id === id(local))?.canonical_text ?? ''}” the thesis is no longer supported.`,
    targets: onClaim(local),
  })),
  ...['i1', 'i2'].map((local): AnalysisFinding<LocalId> => ({
    kind: 'unchecked_step',
    severity: 'info',
    produced_by: 'deductive-validity@1.0.0',
    explanation:
      'This step is deductive but was not formalized, so whether it is valid was not checked.',
    targets: onInference(local),
  })),
  {
    kind: 'unconnected_claim',
    severity: 'info',
    produced_by: 'unconnected-claim@1.0.0',
    explanation: '“The standard of review is de novo.” takes part in no inference or relation.',
    targets: onClaim('c1'),
  },
];

function events(runId: RunId, spans: number): NewRunEvent[] {
  const e = (
    type: NewRunEvent['type'],
    stage: NewRunEvent['stage'],
    payload: NewRunEvent['payload'] = null,
  ): NewRunEvent => ({ run_id: runId, type, stage, payload });
  return [
    e('stage_started', 'segment'),
    e('stage_completed', 'segment', { spans }),
    e('stage_started', 'classify'),
    e('stage_progress', 'classify', {
      message: `Classified 3 of ${String(spans)} spans`,
      classified: 3,
      total: spans,
    }),
    e('stage_progress', 'classify', {
      message: `Classified ${String(spans)} of ${String(spans)} spans`,
      classified: spans,
      total: spans,
    }),
    e('stage_completed', 'classify', { argumentative: 3 }),
    e('stage_started', 'extract'),
    e('stage_completed', 'extract', { claims: 6, inferences: 2, relations: 1 }),
    e('stage_started', 'reconstruct'),
    e('stage_completed', 'reconstruct', { attempt: 1 }),
    e('stage_started', 'validate'),
    e('validation_retry', 'validate', { attempt: 1, errorCount: 1 }),
    e('stage_completed', 'validate', { errors: 1, warnings: 0 }),
    e('stage_started', 'reconstruct'),
    e('stage_completed', 'reconstruct', { attempt: 2 }),
    e('stage_started', 'validate'),
    e('stage_completed', 'validate', { errors: 0, warnings: 1 }),
    e('stage_started', 'analyze'),
    e('stage_completed', 'analyze', { findings: findings.length }),
    e('stage_started', 'persist'),
    e('stage_completed', 'persist'),
  ];
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const env = serverEnv();
  const { db, close } = createDb(env.DATABASE_URL);
  const repositories = createRepositories(db);

  try {
    const { sourceText, spans } = buildDocument();
    const document = await repositories.documents.create({
      source_text: sourceText,
      title: live ? 'Demo: notice of renewal (live)' : 'Demo: notice of renewal',
      role: 'own_brief',
    });
    const run = await repositories.runs.create({ document_id: document.id, status: 'queued' });
    console.log(`Open http://localhost:3000/documents/${document.id}`);

    if (live) await sleep(3000);
    await repositories.runs.updateStatus(run.id, {
      status: 'running',
      started_at: new Date(),
      model_config: { seed: 'demo' },
    });
    for (const event of events(run.id, spans.length)) {
      await repositories.runs.appendEvent(event);
      if (event.stage !== null) {
        await repositories.runs.updateStatus(run.id, { current_stage: event.stage });
      }
      if (live) await sleep(450);
    }

    const revisionId = await repositories.revisions.saveAnalysisResult({
      documentId: document.id,
      runId: run.id,
      spans,
      draft,
      findings,
    });
    await repositories.runs.updateStatus(run.id, {
      status: 'completed',
      revision_id: revisionId,
      current_stage: null,
      finished_at: new Date(),
    });
    console.log(`Seeded document ${document.id}, run ${run.id}, revision ${revisionId}.`);
  } finally {
    await close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
