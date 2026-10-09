import { classifyPrompt } from './classify.v1.ts';
import { extractPrompt } from './extract.v1.ts';
import { promptLabel } from './prompt.ts';
import { reconstructPrompt } from './reconstruct.v2.ts';
import { summarizePrompt } from './summarize.v1.ts';

export * from './prompt.ts';
export * from './guardrails.ts';
export * from './classify.v1.ts';
export * from './summarize.v1.ts';
export * from './extract.v1.ts';
export * from './reconstruct.v2.ts';

/** The prompt versions in use, for `AnalysisRun.model_config`. */
export const PROMPT_VERSIONS: Readonly<Record<string, string>> = {
  classify: promptLabel(classifyPrompt),
  summarize: promptLabel(summarizePrompt),
  extract: promptLabel(extractPrompt),
  reconstruct: promptLabel(reconstructPrompt),
};
