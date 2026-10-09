import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import {
  describeLlmConfig,
  type LlmConfig,
  type LlmStage,
  type StageModelConfig,
} from '@make-your-case/domain';
import type { ModelProvider } from './model-provider.ts';

/** Transient API failures (rate limits, overload) are retried by the client with backoff. */
const MAX_RETRIES = 3;

/**
 * The output budget for every stage.
 *
 * This must be set explicitly. LangChain picks a default from a table of model
 * name prefixes, and a model the table does not know falls back to 4096 — which
 * silently truncated `reconstruct` mid-object on a brief of any size, leaving a
 * half-written JSON string that no repair could parse. The table ages every
 * time a provider ships a model, so relying on it is a slow-acting trap.
 *
 * A cap costs nothing when it is not reached: billing is per token generated.
 * But it cannot simply be set enormous either — Anthropic's SDK refuses a
 * non-streaming request whose budget could take over ten minutes, which works
 * out at 21,333 tokens ((3600 × maxTokens) / 128000 > 600). This sits below
 * that, four times the 4096 the stale table was giving us. If a document ever
 * needs more, the answer is to stream rather than to raise this.
 */
const MAX_OUTPUT_TOKENS = 16_384;

/**
 * Builds chat models from resolved configuration (see `resolveLlmConfig`).
 *
 * No sampling parameters are set: several current models reject `temperature`,
 * and the pipeline's determinism comes from validation and analysis, not from
 * the model. The output budget, however, is set explicitly — see
 * `MAX_OUTPUT_TOKENS`.
 */
export function createModelProvider(config: LlmConfig): ModelProvider {
  const models = new Map<LlmStage, BaseChatModel>();

  return {
    getChatModel(stage) {
      const cached = models.get(stage);
      if (cached !== undefined) return cached;

      const stageConfig = config[stage];
      if (stageConfig === undefined) {
        throw new Error(`No model is configured for the '${stage}' stage`);
      }
      const model = buildChatModel(stageConfig);
      models.set(stage, model);
      return model;
    },
    describe() {
      return describeLlmConfig(config);
    },
  };
}

function buildChatModel({ provider, model, apiKey }: StageModelConfig): BaseChatModel {
  switch (provider) {
    case 'anthropic':
      return new ChatAnthropic({
        model,
        apiKey,
        maxRetries: MAX_RETRIES,
        maxTokens: MAX_OUTPUT_TOKENS,
      });
    case 'openai':
      return new ChatOpenAI({
        model,
        apiKey,
        maxRetries: MAX_RETRIES,
        maxTokens: MAX_OUTPUT_TOKENS,
      });
    default: {
      // Adding a provider to `llmProviderSchema` makes this a compile error until it has a case.
      const unhandled: never = provider;
      throw new Error(`Unsupported LLM provider: ${String(unhandled)}`);
    }
  }
}
