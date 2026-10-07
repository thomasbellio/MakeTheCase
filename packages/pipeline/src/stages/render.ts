import type { SegmentedSpan } from './segment.ts';

export interface RenderOptions {
  /** Include each span's classification label. */
  readonly withFunction: boolean;
}

/**
 * Renders spans one per line for a prompt: `[s12] (argumentative) 17. text`.
 * Headings are prefixed with `#` marks and list items with their marker, so
 * the model sees the document's structure and can resolve "¶ 17" references.
 */
export function renderSpans(
  spans: readonly SegmentedSpan[],
  { withFunction }: RenderOptions,
): string {
  return spans
    .map(({ span, text, listMarker, headingDepth }) => {
      const parts = [`[${span.id}]`];
      if (withFunction) parts.push(`(${span.function})`);
      if (headingDepth !== null) parts.push('#'.repeat(headingDepth));
      if (listMarker !== null) parts.push(listMarker);
      parts.push(text);
      return parts.join(' ');
    })
    .join('\n');
}
