/**
 * Runs the pipeline stages in sequence on one document, without the LangGraph
 * workflow or persistence, and prints what each produced. A development aid
 * for prompt work; makes real, billed API calls and never runs in `pnpm test`.
 *
 *   pnpm --filter @make-your-case/pipeline try:stages ../../fixtures/arguments/05-contract-notice.md
 */
import { readFileSync } from 'node:fs';
import { analyzeArgumentGraph, validateArgumentGraph } from '@make-your-case/analysis';
import { parseEnv, PIPELINE_LLM_STAGES, resolveLlmConfig, toView } from '@make-your-case/domain';
import { createModelProvider } from '../src/llm/index.ts';
import { reconstructResponseToDraft, type ReconstructResponse } from '../src/schemas/index.ts';
import {
  checkPreservation,
  classifySpans,
  countArgumentative,
  extractArgument,
  passesGate,
  reconstructArgument,
  retryFeedback,
  segmentDocument,
  summarizeNonArgument,
} from '../src/stages/index.ts';

const path = process.argv[2];
if (path === undefined) {
  console.error('usage: try:stages <markdown file>');
  process.exit(2);
}

const env = parseEnv();
const resolved = resolveLlmConfig(env, PIPELINE_LLM_STAGES);
if (!resolved.ok) {
  console.error(`LLM configuration is incomplete:\n  ${resolved.errors.join('\n  ')}`);
  process.exit(1);
}
const models = createModelProvider(resolved.value);
const time = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
  const started = Date.now();
  const result = await run();
  console.log(`-- ${label} (${String(Date.now() - started)} ms)`);
  return result;
};

const segmented = segmentDocument(readFileSync(path, 'utf8'));
console.log(`-- segment: ${String(segmented.length)} spans`);

const spans = await time('classify', () =>
  classifySpans(segmented, models.getChatModel('classify')),
);
const counts: Record<string, number> = {};
for (const { span } of spans) counts[span.function] = (counts[span.function] ?? 0) + 1;
console.log(counts, `argumentative above threshold: ${String(countArgumentative(spans))}`);

if (!passesGate(spans, env.GATE_MIN_ARGUMENTATIVE_SPANS)) {
  console.log(
    'not_an_argument:',
    await summarizeNonArgument(spans, models.getChatModel('classify')),
  );
  process.exit(0);
}

const extracted = await time('extract', () =>
  extractArgument(spans, models.getChatModel('extract')),
);
console.log(
  `${String(extracted.claims.length)} claims, ${String(extracted.inferences.length)} inferences, ${String(extracted.relations.length)} relations`,
);

const spanIds = spans.map(({ span }) => span.id);
let retry: { previous: ReconstructResponse; errors: string[] } | null = null;
for (let attempt = 0; attempt <= env.PIPELINE_MAX_VALIDATION_RETRIES; attempt++) {
  const response = await time(`reconstruct, attempt ${String(attempt + 1)}`, () =>
    reconstructArgument({ spans, extracted, retry }, models.getChatModel('reconstruct')),
  );
  const { draft, issues } = reconstructResponseToDraft(response);
  const validation = validateArgumentGraph(draft, spanIds);
  const errors = [
    ...issues,
    ...(validation.ok ? [] : validation.errors),
    ...checkPreservation(extracted, draft),
  ];
  for (const warning of validation.warnings) console.log(`   warning: ${warning.message}`);

  if (errors.length === 0) {
    console.log(
      `-- valid: ${String(draft.claims.length)} claims, ${String(draft.inferences.length)} inferences`,
    );
    for (const claim of draft.claims) {
      console.log(
        `   ${claim.id} [${claim.origin}/${claim.attribution}/${claim.kind}/${claim.modality}]${claim.is_thesis ? ' THESIS' : ''} ${claim.canonical_text}${claim.citation === null ? '' : ` (${claim.citation})`}`,
      );
    }
    for (const finding of analyzeArgumentGraph(toView(draft))) {
      console.log(`   finding ${finding.severity} ${finding.kind}: ${finding.explanation}`);
    }
    process.exit(0);
  }
  for (const error of errors) console.log(`   error [${error.rule}]: ${error.message}`);
  retry = { previous: response, errors: retryFeedback(errors) };
}
console.log('-- failed: still invalid after the maximum number of retries');
process.exit(1);
