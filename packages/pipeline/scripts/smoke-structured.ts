/**
 * Manual check that the configured providers accept the wire schemas in
 * structured-output mode (AGENTS.md section 8.1). Makes real, billed API calls,
 * so it never runs in `pnpm test`.
 *
 *   pnpm --filter @make-your-case/pipeline smoke:structured
 *
 * Uses the same environment as the worker; each configured pipeline stage is
 * exercised once against its own provider and model.
 */
import {
  parseEnv,
  PIPELINE_LLM_STAGES,
  resolveLlmConfig,
  type LlmStage,
} from '@make-your-case/domain';
import { createModelProvider, invokeStructured } from '../src/llm/index.ts';
import {
  classifyResponseSchema,
  extractResponseSchema,
  reconstructResponseSchema,
  reconstructResponseToDraft,
} from '../src/schemas/index.ts';

const SAMPLE = [
  '[s1] Under the lease, notice of termination must be given in writing.',
  '[s2] The tenant sent notice by email on March 3.',
  '[s3] Therefore the tenant validly terminated the lease.',
].join('\n');

const resolved = resolveLlmConfig(parseEnv(), PIPELINE_LLM_STAGES);
if (!resolved.ok) {
  console.error(`LLM configuration is incomplete:\n  ${resolved.errors.join('\n  ')}`);
  process.exit(1);
}
const provider = createModelProvider(resolved.value);

const checks: Record<(typeof PIPELINE_LLM_STAGES)[number], () => Promise<unknown>> = {
  classify: () =>
    invokeStructured(
      provider.getChatModel('classify'),
      classifyResponseSchema,
      [['human', `Label each span's discourse function.\n${SAMPLE}`]],
      'classify_spans',
    ),
  extract: () =>
    invokeStructured(
      provider.getChatModel('extract'),
      extractResponseSchema,
      [['human', `Extract the stated claims, thesis and inferences.\n${SAMPLE}`]],
      'extract_argument',
    ),
  reconstruct: async () => {
    const response = await invokeStructured(
      provider.getChatModel('reconstruct'),
      reconstructResponseSchema,
      [
        [
          'human',
          `Reconstruct this argument. Add the unstated premise that email counts as writing as an inferred claim, and formalize the step.\n${SAMPLE}`,
        ],
      ],
      'reconstruct_argument',
    );
    return reconstructResponseToDraft(response);
  },
};

let failed = false;
for (const stage of PIPELINE_LLM_STAGES) {
  const { provider: name, model } = provider.describe()[stage as LlmStage] ?? {};
  try {
    const result = await checks[stage]();
    console.log(`ok   ${stage} (${String(name)} ${String(model)})`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    failed = true;
    console.error(`FAIL ${stage} (${String(name)} ${String(model)}): ${(error as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
