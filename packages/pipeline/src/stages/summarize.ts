import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeStructured } from '../llm/structured.ts';
import { summarizePrompt } from '../prompts/summarize.v1.ts';
import { summarizeResponseSchema } from '../schemas/wire.ts';
import { promptMessages } from './messages.ts';
import { renderSpans } from './render.ts';
import type { SegmentedSpan } from './segment.ts';

/** The short genre summary a `not_an_argument` run must carry. Uses the classify model. */
export async function summarizeNonArgument(
  spans: readonly SegmentedSpan[],
  model: BaseChatModel,
): Promise<string> {
  const response = await invokeStructured(
    model,
    summarizeResponseSchema,
    promptMessages(summarizePrompt, { document: renderSpans(spans, { withFunction: false }) }),
    'summarize_document',
  );
  return response.summary.trim();
}
