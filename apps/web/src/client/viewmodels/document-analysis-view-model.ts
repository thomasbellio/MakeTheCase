import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import type { AnalysisRun, DocumentDetail, DocumentId, SpanId } from '@make-your-case/domain';
import type { ApiClient } from '../api/api-client.ts';
import { indexArgument, type ArgumentIndex } from '../model/argument-index.ts';
import {
  firstSpan,
  highlightFor,
  NO_HIGHLIGHT,
  sameSelection,
  type Highlight,
  type Selection,
} from '../model/highlight.ts';
import { ArgumentMapViewModel, type LayoutFn } from './argument-map-view-model.ts';
import { FindingsViewModel } from './findings-view-model.ts';
import { InspectorViewModel } from './inspector-view-model.ts';
import { RunProgressViewModel, type RunOutcome } from './run-progress-view-model.ts';
import type { SelectionSource } from './selection.ts';

export type DocumentPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  /** The document exists but was never queued for analysis. */
  | { readonly kind: 'no_run' }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'not_an_argument'; readonly summary: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'complete' };

const GENERIC_FAILURE = 'The analysis stopped before it finished.';

/**
 * The document screen (AGENTS.md section 9.2). Loads the document, follows
 * its run while it is in progress, then holds the analyzed argument and the
 * **one** selection every panel shares: the source text, the map, the
 * findings and the inspector all read `selection` and `highlight` from here
 * and change them only through `select`.
 */
export class DocumentAnalysisViewModel {
  phase: DocumentPhase = { kind: 'loading' };
  detail: DocumentDetail | null = null;
  index: ArgumentIndex | null = null;

  progress: RunProgressViewModel | null = null;
  map: ArgumentMapViewModel | null = null;
  findings: FindingsViewModel | null = null;
  inspector: InspectorViewModel | null = null;

  selection: Selection | null = null;
  hovered: Selection | null = null;
  /** The span the source panel should scroll to; `token` changes on every request. */
  scrollRequest: { readonly spanId: SpanId; readonly token: number } | null = null;

  readonly documentId: DocumentId;
  private readonly api: ApiClient;
  private readonly runLayout: LayoutFn;

  constructor(api: ApiClient, documentId: DocumentId, runLayout: LayoutFn) {
    this.api = api;
    this.documentId = documentId;
    this.runLayout = runLayout;
    makeAutoObservable<this, 'api' | 'runLayout'>(
      this,
      {
        api: false,
        runLayout: false,
        documentId: false,
        phase: observableRef,
        detail: observableRef,
        index: observableRef,
        progress: observableRef,
        map: observableRef,
        findings: observableRef,
        inspector: observableRef,
        selection: observableRef,
        hovered: observableRef,
        scrollRequest: observableRef,
      },
      { autoBind: true },
    );
  }

  get title(): string {
    return this.detail?.document.title ?? 'Untitled document';
  }

  get sourceText(): string {
    return this.detail?.document.source_text ?? '';
  }

  /** What every panel lights up: a hover previews, otherwise the selection. */
  get highlight(): Highlight {
    return this.index === null
      ? NO_HIGHLIGHT
      : highlightFor(this.index, this.hovered ?? this.selection);
  }

  /**
   * Starts a session for one mount of the screen: loads the document and
   * follows its run. The returned function ends the session, closing its
   * event stream and discarding any response still in flight.
   *
   * A session, not a one-shot `dispose`, because the same ViewModel can be
   * mounted again after its cleanup ran: React Strict Mode does exactly that
   * in development, and a one-shot flag left the page loading for ever.
   */
  activate(): () => void {
    const session = new AbortController();
    void this.load(session.signal);
    return () => {
      session.abort();
    };
  }

  /** Loads the document; everything it starts stops when `signal` aborts. */
  async load(signal: AbortSignal = new AbortController().signal): Promise<void> {
    const result = await this.api.getDocument(this.documentId);
    if (signal.aborted) return;
    if (!result.ok) {
      runInAction(() => {
        this.phase = { kind: 'error', message: result.error.message };
      });
      return;
    }

    runInAction(() => {
      this.detail = result.value;
    });
    const run = result.value.latestRun;
    if (run === null) {
      runInAction(() => {
        this.phase = { kind: 'no_run' };
      });
      return;
    }
    await this.follow(run, signal);
  }

  select(selection: Selection | null, source: SelectionSource): void {
    // Picking the same element again in the map or the text clears it.
    const next =
      selection !== null && source !== 'findings' && sameSelection(selection, this.selection)
        ? null
        : selection;
    this.selection = next;
    this.hovered = null;

    const index = this.index;
    if (next === null || index === null) return;
    if (next.type === 'finding') this.findings?.sync(next.id);

    const highlight = highlightFor(index, next);
    // The panel the user picked in already shows the element.
    if (source !== 'source') {
      const spanId = firstSpan(index, highlight);
      if (spanId !== null) {
        this.scrollRequest = { spanId, token: (this.scrollRequest?.token ?? 0) + 1 };
      }
    }
    if (source !== 'map') this.map?.focus(highlight);
  }

  hover(selection: Selection | null): void {
    if (!sameSelection(selection, this.hovered)) this.hovered = selection;
  }

  /*
   * Every await below is followed by a `signal.aborted` check: a response
   * arriving after its session ended must not start a layout or open a stream.
   */
  private async follow(run: AnalysisRun, signal: AbortSignal): Promise<void> {
    switch (run.status) {
      case 'queued':
      case 'running': {
        const progress = new RunProgressViewModel(this.api, run, (outcome) => {
          void this.finished(outcome, signal);
        });
        runInAction(() => {
          this.progress = progress;
          this.phase = { kind: 'in_progress' };
        });
        signal.addEventListener(
          'abort',
          () => {
            progress.dispose();
          },
          { once: true },
        );
        progress.start();
        return;
      }
      case 'completed':
        await this.loadArgument(signal);
        return;
      case 'not_an_argument':
        runInAction(() => {
          this.phase = {
            kind: 'not_an_argument',
            summary: run.summary ?? 'The text does not appear to make an argument.',
          };
        });
        return;
      case 'failed':
        runInAction(() => {
          this.phase = { kind: 'failed', message: run.error ?? GENERIC_FAILURE };
        });
        return;
    }
  }

  private async finished(outcome: RunOutcome, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (outcome.status === 'not_an_argument') {
      this.phase = { kind: 'not_an_argument', summary: outcome.summary };
      return;
    }
    if (outcome.status === 'failed') {
      this.phase = { kind: 'failed', message: outcome.message };
      return;
    }

    // Spans are written when the analysis is saved, so the detail fetched
    // while the run was in progress has none; fetch it again.
    const detail = await this.api.getDocument(this.documentId);
    if (isAborted(signal)) return;
    if (!detail.ok) {
      runInAction(() => {
        this.phase = { kind: 'error', message: detail.error.message };
      });
      return;
    }
    runInAction(() => {
      this.detail = detail.value;
    });
    await this.loadArgument(signal);
  }

  private async loadArgument(signal: AbortSignal): Promise<void> {
    const result = await this.api.getArgument(this.documentId);
    if (signal.aborted) return;
    const detail = this.detail;
    if (!result.ok || detail === null) {
      runInAction(() => {
        this.phase = {
          kind: 'error',
          message: result.ok ? 'The document could not be loaded.' : result.error.message,
        };
      });
      return;
    }

    const index = indexArgument(result.value, detail.spans);
    const map = new ArgumentMapViewModel(index, this.runLayout, this);
    runInAction(() => {
      this.index = index;
      this.map = map;
      this.findings = new FindingsViewModel(index, this);
      this.inspector = new InspectorViewModel(index, detail.document.source_text, this);
      this.phase = { kind: 'complete' };
    });
    await map.layout();
  }
}

/** Read through a call: a second check of `signal.aborted` reads as narrowed across an `await`. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
