import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmConfigDescription, LlmStage } from '@make-your-case/domain';

/**
 * The port every LLM stage depends on (AGENTS.md section 8.1).
 *
 * Stage code asks for a model by stage and uses only `withStructuredOutput`
 * (through `invokeStructured`), so nothing downstream depends on which
 * provider is behind it.
 */
export interface ModelProvider {
  getChatModel(stage: LlmStage): BaseChatModel;
  /** Provider and model per stage, with no secrets, for `AnalysisRun.model_config`. */
  describe(): LlmConfigDescription;
}
