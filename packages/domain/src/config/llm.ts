import { z } from 'zod';
import type { Env } from './env.ts';

/**
 * LLM provider configuration (AGENTS.md sections 8.1 and 10).
 *
 * `LLM_PROVIDER` and `LLM_MODEL_DEFAULT` apply to every stage; the optional
 * `LLM_PROVIDER_<STAGE>` and `LLM_MODEL_<STAGE>` variables override them for
 * one stage. Adding a provider (Bedrock, an OpenAI-compatible endpoint) means
 * a new enum value here, its key in `API_KEY_VAR`, and a new case in the
 * pipeline's provider factory.
 */
export const llmProviderSchema = z.enum(['anthropic', 'openai']);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

/** The stages that call a model. `judge` is used only by the eval harness. */
export const llmStageSchema = z.enum(['classify', 'extract', 'reconstruct', 'judge']);
export type LlmStage = z.infer<typeof llmStageSchema>;

/** The stages the analysis pipeline itself needs; `judge` is eval-only. */
export const PIPELINE_LLM_STAGES = [
  'classify',
  'extract',
  'reconstruct',
] as const satisfies readonly LlmStage[];

export interface StageModelConfig {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly apiKey: string;
}

/** Resolved settings for the requested stages. Holds secrets: never log it; log `describeLlmConfig` instead. */
export type LlmConfig = Readonly<Partial<Record<LlmStage, StageModelConfig>>>;

/** The secret-free summary recorded in `AnalysisRun.model_config` and in logs. */
export type LlmConfigDescription = Readonly<
  Partial<Record<LlmStage, { readonly provider: LlmProvider; readonly model: string }>>
>;

export type LlmConfigResult =
  | { readonly ok: true; readonly value: LlmConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

const API_KEY_VAR = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
} as const satisfies Record<LlmProvider, keyof Env>;

const STAGE_VARS = {
  classify: { provider: 'LLM_PROVIDER_CLASSIFY', model: 'LLM_MODEL_CLASSIFY' },
  extract: { provider: 'LLM_PROVIDER_EXTRACT', model: 'LLM_MODEL_EXTRACT' },
  reconstruct: { provider: 'LLM_PROVIDER_RECONSTRUCT', model: 'LLM_MODEL_RECONSTRUCT' },
  judge: { provider: 'LLM_PROVIDER_JUDGE', model: 'LLM_MODEL_JUDGE' },
} as const satisfies Record<LlmStage, { provider: keyof Env; model: keyof Env }>;

/**
 * Resolves the provider, model and API key for each requested stage.
 *
 * Reports every problem at once rather than the first. Error messages name
 * variables, never their values, so a misplaced secret cannot reach a log.
 */
export function resolveLlmConfig(env: Env, stages: readonly LlmStage[]): LlmConfigResult {
  const errors: string[] = [];
  const config: Partial<Record<LlmStage, StageModelConfig>> = {};

  for (const stage of stages) {
    const vars = STAGE_VARS[stage];
    const provider = env[vars.provider] ?? env.LLM_PROVIDER;
    const model = nonEmpty(env[vars.model]) ?? nonEmpty(env.LLM_MODEL_DEFAULT);
    const keyVar = API_KEY_VAR[provider];
    const apiKey = nonEmpty(env[keyVar]);

    if (model === undefined) {
      errors.push(`${stage}: no model configured; set ${vars.model} or LLM_MODEL_DEFAULT`);
    }
    if (apiKey === undefined) {
      errors.push(`${stage}: provider '${provider}' requires ${keyVar}`);
    }
    if (model !== undefined && apiKey !== undefined) {
      config[stage] = { provider, model, apiKey };
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: config };
}

export function describeLlmConfig(config: LlmConfig): LlmConfigDescription {
  const description: Partial<Record<LlmStage, { provider: LlmProvider; model: string }>> = {};
  for (const stage of llmStageSchema.options) {
    const resolved = config[stage];
    if (resolved !== undefined) {
      description[stage] = { provider: resolved.provider, model: resolved.model };
    }
  }
  return description;
}

// `.env.example` leaves unused variables blank, which arrive as empty strings.
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}
