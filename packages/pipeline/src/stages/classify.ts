import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeStructured } from '../llm/structured.ts';
import { classifyPrompt } from '../prompts/classify.v1.ts';
import { classifyResponseSchema } from '../schemas/wire.ts';
import { promptMessages } from './messages.ts';
import { renderSpans } from './render.ts';
import type { SegmentedSpan } from './segment.ts';

export const CLASSIFY_BATCH_SIZE = 40;
export const CLASSIFY_CONTEXT_SPANS = 3;

export interface ClassifyOptions {
  readonly batchSize?: number;
  /** Called after each batch with the number of spans classified so far. */
  readonly onProgress?: (classified: number, total: number) => void | Promise<void>;
}

/**
 * Labels each span's discourse function (AGENTS.md section 8.2, `classify`).
 *
 * Spans go to the model in batches, each with a few neighbouring spans shown
 * as context so a sentence is not judged in isolation. Labels for IDs outside
 * the batch are ignored, and a span the model skips stays `unclassified`
 * rather than failing the run: classification informs extraction but never
 * gates what it may see.
 */
export async function classifySpans(
  spans: readonly SegmentedSpan[],
  model: BaseChatModel,
  { batchSize = CLASSIFY_BATCH_SIZE, onProgress }: ClassifyOptions = {},
): Promise<SegmentedSpan[]> {
  const labelled = [...spans];

  for (let start = 0; start < spans.length; start += batchSize) {
    const end = Math.min(start + batchSize, spans.length);
    const batch = spans.slice(start, end);
    const render = (slice: readonly SegmentedSpan[]) => renderSpans(slice, { withFunction: false });

    const response = await invokeStructured(
      model,
      classifyResponseSchema,
      promptMessages(classifyPrompt, {
        spans: render(batch),
        before: render(spans.slice(Math.max(0, start - CLASSIFY_CONTEXT_SPANS), start)),
        after: render(spans.slice(end, end + CLASSIFY_CONTEXT_SPANS)),
      }),
      'classify_spans',
    );

    const labels = new Map(response.labels.map((label) => [label.span_id, label]));
    for (let index = start; index < end; index++) {
      const current = labelled[index];
      const label = current === undefined ? undefined : labels.get(current.span.id);
      if (current === undefined || label === undefined) continue;
      labelled[index] = {
        ...current,
        span: {
          ...current.span,
          function: label.function,
          function_confidence: clamp(label.confidence),
        },
      };
    }

    await onProgress?.(end, spans.length);
  }

  return labelled;
}

function clamp(confidence: number): number {
  return Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
}
