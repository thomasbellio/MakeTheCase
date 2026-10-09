import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeStructured } from '../llm/structured.ts';
import { reconstructPrompt } from '../prompts/reconstruct.v2.ts';
import {
  reconstructResponseSchema,
  type ExtractResponse,
  type ReconstructResponse,
} from '../schemas/wire.ts';
import { promptMessages } from './messages.ts';
import { renderSpans } from './render.ts';
import type { SegmentedSpan } from './segment.ts';

export interface ReconstructInput {
  readonly spans: readonly SegmentedSpan[];
  readonly extracted: ExtractResponse;
  /** On a retry: the attempt that failed validation and its error messages. */
  readonly retry: {
    readonly previous: ReconstructResponse;
    readonly errors: readonly string[];
  } | null;
}

/**
 * Normalizes and completes the extracted argument (AGENTS.md section 8.2,
 * `reconstruct`, following the policy in section 8.3).
 *
 * Returns the wire response; `reconstructResponseToDraft` turns it into a
 * draft, and the wire form is kept so a retry can show the model exactly what
 * it produced alongside what was wrong with it.
 */
export async function reconstructArgument(
  { spans, extracted, retry }: ReconstructInput,
  model: BaseChatModel,
): Promise<ReconstructResponse> {
  return invokeStructured(
    model,
    reconstructResponseSchema,
    promptMessages(reconstructPrompt, {
      document: renderSpans(spans, { withFunction: false }),
      extracted: JSON.stringify(extracted),
      retry:
        retry === null ? null : { previous: JSON.stringify(retry.previous), errors: retry.errors },
    }),
    'reconstruct_argument',
  );
}
