import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeStructured } from '../llm/structured.ts';
import { extractPrompt } from '../prompts/extract.v1.ts';
import { extractResponseSchema, type ExtractResponse } from '../schemas/wire.ts';
import { promptMessages } from './messages.ts';
import { renderSpans } from './render.ts';
import type { SegmentedSpan } from './segment.ts';

/**
 * Extracts the stated argument (AGENTS.md section 8.2, `extract`).
 *
 * The whole document goes in one call, with every span and its label:
 * classification informs extraction but never filters it, because premises
 * are often stated only in narrative sections. The result stays in wire form;
 * it is reconstruct's input and the reference the preservation check holds
 * reconstruct to, never a draft in its own right.
 */
export async function extractArgument(
  spans: readonly SegmentedSpan[],
  model: BaseChatModel,
): Promise<ExtractResponse> {
  return invokeStructured(
    model,
    extractResponseSchema,
    promptMessages(extractPrompt, { document: renderSpans(spans, { withFunction: true }) }),
    'extract_argument',
  );
}
