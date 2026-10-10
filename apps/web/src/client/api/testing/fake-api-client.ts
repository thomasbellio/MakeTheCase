import type {
  AnalysisRun,
  ArgumentGraph,
  CreateDocumentRequest,
  CreateDocumentResponse,
  DocumentDetail,
  DocumentId,
  DocumentSummary,
  RunEvent,
  RunId,
  RunStatus,
} from '@make-your-case/domain';
import type {
  ApiClient,
  ApiFailure,
  ApiResult,
  RunEventHandlers,
  Unsubscribe,
} from '../api-client.ts';

/**
 * An `ApiClient` for ViewModel tests (AGENTS.md section 9.1): scripted
 * responses, a record of every request, and run streams the test drives by
 * hand.
 */
export class FakeApiClient implements ApiClient {
  readonly submitted: CreateDocumentRequest[] = [];
  readonly streams: FakeRunStream[] = [];

  submitResult: ApiResult<CreateDocumentResponse> = failure('internal', 'not scripted');
  documents: ApiResult<DocumentSummary[]> = { ok: true, value: [] };
  readonly details = new Map<DocumentId, ApiResult<DocumentDetail>>();
  readonly arguments = new Map<DocumentId, ApiResult<ArgumentGraph>>();
  readonly runs = new Map<RunId, ApiResult<AnalysisRun>>();

  submitDocument(request: CreateDocumentRequest): Promise<ApiResult<CreateDocumentResponse>> {
    this.submitted.push(request);
    return Promise.resolve(this.submitResult);
  }

  listDocuments(): Promise<ApiResult<DocumentSummary[]>> {
    return Promise.resolve(this.documents);
  }

  getDocument(id: DocumentId): Promise<ApiResult<DocumentDetail>> {
    return Promise.resolve(this.details.get(id) ?? failure('not_found', 'no such document'));
  }

  getArgument(id: DocumentId): Promise<ApiResult<ArgumentGraph>> {
    return Promise.resolve(this.arguments.get(id) ?? failure('not_found', 'no argument'));
  }

  getRun(id: RunId): Promise<ApiResult<AnalysisRun>> {
    return Promise.resolve(this.runs.get(id) ?? failure('not_found', 'no such run'));
  }

  subscribeRunEvents(runId: RunId, afterSequence: number, handlers: RunEventHandlers): Unsubscribe {
    const stream = new FakeRunStream(runId, afterSequence, handlers);
    this.streams.push(stream);
    return () => {
      stream.closed = true;
    };
  }

  /** The most recent stream opened for `runId`. */
  streamFor(runId: RunId): FakeRunStream {
    const stream = this.streams.filter((s) => s.runId === runId).at(-1);
    if (stream === undefined) throw new Error(`no stream was opened for ${runId}`);
    return stream;
  }
}

export class FakeRunStream {
  closed = false;
  readonly runId: RunId;
  readonly afterSequence: number;
  private readonly handlers: RunEventHandlers;

  constructor(runId: RunId, afterSequence: number, handlers: RunEventHandlers) {
    this.runId = runId;
    this.afterSequence = afterSequence;
    this.handlers = handlers;
  }

  emit(event: RunEvent): void {
    if (!this.closed) this.handlers.onEvent(event);
  }

  end(status: RunStatus): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onEnd({ status });
  }

  connection(state: 'open' | 'reconnecting'): void {
    this.handlers.onConnection?.(state);
  }
}

export function failure<T>(code: ApiFailure['code'], message: string): ApiResult<T> {
  return { ok: false, error: { code, message } };
}
