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
 * Builds chat models from resolved configuration (see `resolveLlmConfig`).
 *
 * No sampling parameters are set: several current models reject `temperature`,
 * and the pipeline's determinism comes from validation and analysis, not from
 * the model. Each client takes its `maxTokens` default from the model's profile.
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
      return new ChatAnthropic({ model, apiKey, maxRetries: MAX_RETRIES });
    case 'openai':
      return new ChatOpenAI({ model, apiKey, maxRetries: MAX_RETRIES });
    default: {
      // Adding a provider to `llmProviderSchema` makes this a compile error until it has a case.
      const unhandled: never = provider;
      throw new Error(`Unsupported LLM provider: ${String(unhandled)}`);
    }
  }
}
