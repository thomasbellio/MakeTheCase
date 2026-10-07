import type {
  BaseLanguageModelInput,
  StructuredOutputMethodOptions,
} from '@langchain/core/language_models/base';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { RunnableLambda, type Runnable } from '@langchain/core/runnables';
import type { LlmConfigDescription, LlmStage } from '@make-your-case/domain';
import type { ModelProvider } from '../llm/model-provider.ts';

/**
 * A scripted response: the structured value to return, an error to throw, or
 * (via `malformed`) raw output that fails to parse.
 */
export type ScriptedResponse = Record<string, unknown> | Error | MalformedResponse;

export class MalformedResponse {
  constructor(readonly args: unknown) {}
}

/** Scripts output that the provider's own parser rejects, carrying `args` as the raw tool-call arguments. */
export function malformed(args: unknown): MalformedResponse {
  return new MalformedResponse(args);
}

export interface RecordedCall {
  readonly stage: LlmStage;
  readonly name: string | undefined;
  readonly input: BaseLanguageModelInput;
  /** Every message's text joined, for asserting on what a prompt contained. */
  readonly text: string;
}

/**
 * A `ModelProvider` that returns scripted structured responses (AGENTS.md
 * section 8.1), for pipeline tests that must not reach a real provider.
 *
 * Each stage has a queue; every structured call pops the next response. When
 * the caller's schema is a Zod schema, the response is parsed through it, so a
 * fixture that does not match the wire schema fails loudly instead of slipping
 * through. Running out of responses is an error.
 */
export class FakeModelProvider implements ModelProvider {
  readonly calls: RecordedCall[] = [];
  private readonly queues = new Map<LlmStage, ScriptedResponse[]>();

  constructor(script: Partial<Record<LlmStage, readonly ScriptedResponse[]>> = {}) {
    for (const [stage, responses] of Object.entries(script) as [LlmStage, ScriptedResponse[]][]) {
      this.queues.set(stage, [...responses]);
    }
  }

  /** Appends responses to a stage's queue. */
  enqueue(stage: LlmStage, ...responses: ScriptedResponse[]): this {
    this.queues.set(stage, [...(this.queues.get(stage) ?? []), ...responses]);
    return this;
  }

  callsFor(stage: LlmStage): RecordedCall[] {
    return this.calls.filter((call) => call.stage === stage);
  }

  remaining(stage: LlmStage): number {
    return this.queues.get(stage)?.length ?? 0;
  }

  getChatModel(stage: LlmStage): BaseChatModel {
    return new ScriptedChatModel(stage, this);
  }

  describe(): LlmConfigDescription {
    return {
      classify: { provider: 'anthropic', model: 'fake' },
      extract: { provider: 'anthropic', model: 'fake' },
      reconstruct: { provider: 'anthropic', model: 'fake' },
      judge: { provider: 'anthropic', model: 'fake' },
    };
  }

  /** @internal Used by `ScriptedChatModel`. */
  next(call: RecordedCall): ScriptedResponse {
    this.calls.push(call);
    const response = this.queues.get(call.stage)?.shift();
    if (response === undefined) {
      throw new Error(`FakeModelProvider: no scripted response left for stage '${call.stage}'`);
    }
    return response;
  }
}

interface ParsingSchema {
  parse(value: unknown): unknown;
}

function isParsingSchema(value: unknown): value is ParsingSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ParsingSchema).parse === 'function'
  );
}

class ScriptedChatModel extends BaseChatModel {
  constructor(
    private readonly stage: LlmStage,
    private readonly provider: FakeModelProvider,
  ) {
    super({});
  }

  _llmType(): string {
    return 'scripted-fake';
  }

  _generate(): Promise<ChatResult> {
    return Promise.reject(new Error('ScriptedChatModel supports only withStructuredOutput'));
  }

  // A single signature compatible with every base overload; the result type is
  // whatever the caller's schema says, which the parse below enforces.
  override withStructuredOutput<RunOutput extends Record<string, unknown>>(
    schema: unknown,
    config?: StructuredOutputMethodOptions<boolean>,
  ): Runnable<BaseLanguageModelInput, RunOutput> {
    return RunnableLambda.from((input: BaseLanguageModelInput) => {
      const response = this.provider.next({
        stage: this.stage,
        name: config?.name,
        input,
        text: textOf(input),
      });
      if (response instanceof Error) throw response;

      // Mirrors the providers: with includeRaw a parse failure yields `parsed: null`, otherwise it throws.
      const raw = new AIMessage({
        content: '',
        tool_calls: [
          {
            name: config?.name ?? 'output',
            args: (response instanceof MalformedResponse ? response.args : response) as Record<
              string,
              unknown
            >,
            id: 'call',
          },
        ],
      });
      let parsed: unknown = null;
      if (!(response instanceof MalformedResponse)) {
        parsed = isParsingSchema(schema) ? schema.parse(response) : response;
      } else if (config?.includeRaw !== true) {
        throw new Error('Failed to parse structured output');
      }
      return (config?.includeRaw === true ? { raw, parsed } : parsed) as RunOutput;
    });
  }
}

function textOf(input: BaseLanguageModelInput): string {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return input.toString();
  return input
    .map((message: unknown) => {
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return String(message[1]);
      const content = (message as { content?: unknown }).content;
      return typeof content === 'string' ? content : JSON.stringify(content);
    })
    .join('\n');
}
