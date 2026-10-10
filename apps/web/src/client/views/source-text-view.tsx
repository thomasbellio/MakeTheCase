'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { SpanId } from '@make-your-case/domain';
import { cn } from '../../lib/utils';
import type { ArgumentIndex } from '../model/argument-index';
import type { Highlight, Selection } from '../model/highlight';
import type { SelectionSource } from '../viewmodels/selection';

/** What the source panel reads; a `DocumentAnalysisViewModel` satisfies it. */
export interface SourceTextScreen {
  readonly sourceText: string;
  readonly index: ArgumentIndex | null;
  readonly highlight: Highlight;
  readonly selection: Selection | null;
  readonly scrollRequest: { readonly spanId: SpanId; readonly token: number } | null;
  select(selection: Selection | null, source: SelectionSource): void;
  hover(selection: Selection | null): void;
}

/**
 * The original text, exactly as submitted, with its spans overlaid
 * (AGENTS.md section 9.2). The text is sliced at the spans' offsets rather than
 * re-rendered as Markdown, so every highlight lands on precisely the characters
 * segmentation measured; Markdown syntax between spans shows as written.
 */
export const SourceTextView = observer(function SourceTextView({
  screen,
}: {
  screen: SourceTextScreen;
}) {
  const { sourceText, index, highlight, selection, scrollRequest } = screen;
  const spanRefs = useRef(new Map<SpanId, HTMLElement>());

  const token = scrollRequest?.token;
  const target = scrollRequest?.spanId;
  useEffect(() => {
    if (target === undefined) return;
    const element = spanRefs.current.get(target);
    // `scrollIntoView` is missing in some test DOMs.
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [token, target]);

  if (index === null) {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed">{sourceText}</p>;
  }

  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const span of index.spans) {
    if (span.char_start > cursor) {
      pieces.push(sourceText.slice(cursor, span.char_start));
    }
    const text = sourceText.slice(span.char_start, span.char_end);
    const claimCount = index.claimsInSpan.get(span.id)?.length ?? 0;
    const interactive = claimCount > 0;
    const highlighted = highlight.spans.has(span.id);
    const selected = selection?.type === 'span' && selection.id === span.id;
    const pick: Selection = { type: 'span', id: span.id };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        screen.select(pick, 'source');
      }
    };

    pieces.push(
      <span
        key={span.id}
        ref={(element) => {
          if (element === null) {
            spanRefs.current.delete(span.id);
          } else {
            spanRefs.current.set(span.id, element);
          }
        }}
        data-span-id={span.id}
        data-highlighted={highlighted || undefined}
        className={cn(
          'rounded-sm',
          span.is_heading && 'font-heading text-base font-semibold',
          interactive &&
            'cursor-pointer decoration-foreground/40 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring',
          // Background plus underline, so a highlight never relies on colour alone.
          highlighted && 'bg-highlight underline decoration-2',
          selected && 'outline-2 outline-ring',
        )}
        {...(interactive
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-pressed': selected,
              'aria-label': `${text} (${String(claimCount)} ${claimCount === 1 ? 'claim' : 'claims'})`,
              onClick: () => {
                screen.select(pick, 'source');
              },
              onKeyDown,
              onMouseEnter: () => {
                screen.hover(pick);
              },
              onMouseLeave: () => {
                screen.hover(null);
              },
            }
          : {})}
      >
        {text}
      </span>,
    );
    cursor = Math.max(cursor, span.char_end);
  }
  if (cursor < sourceText.length) pieces.push(sourceText.slice(cursor));

  return <div className="whitespace-pre-wrap text-sm leading-relaxed">{pieces}</div>;
});
