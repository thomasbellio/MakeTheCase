import {
  analysisRunWireSchema,
  apiErrorResponseSchema,
  createDocumentResponseSchema,
  decodeArgumentResponse,
  decodeWire,
  documentDetailResponseSchema,
  documentListResponseSchema,
  parseWire,
  RUN_STREAM_END_EVENT,
  runEventWireSchema,
  runStreamEndSchema,
  type AnalysisRun,
  type ApiErrorCode,
  type ArgumentGraph,
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  type DocumentDetail,
  type DocumentId,
  type DocumentSummary,
  type RunEvent,
  type RunId,
  type RunStreamEnd,
} from '@make-your-case/domain';

/**
 * The typed API client (AGENTS.md section 9.1): the only client code that
 * calls `fetch` or opens an `EventSource`. Every response is decoded through
 * the contract schemas in `domain`, so ViewModels see real `Date`s and branded
 * ids, and a server that drifts from the contract fails loudly here rather
 * than as an `undefined` deep in a View.
 */

/** A failure the UI can show. `network` means the server could not be reached at all. */
export interface ApiFailure {
  readonly code: ApiErrorCode | 'network';
  readonly message: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

export interface RunEventHandlers {
  onEvent(event: RunEvent): void;
  /** The run reached a terminal status; the stream is closed and will not reopen. */
  onEnd(end: RunStreamEnd): void;
  /** `reconnecting` while the connection is down; `open` once events can flow again. */
  onConnection?(state: 'open' | 'reconnecting'): void;
}

export type Unsubscribe = () => void;

export interface ApiClient {
  submitDocument(request: CreateDocumentRequest): Promise<ApiResult<CreateDocumentResponse>>;
  listDocuments(): Promise<ApiResult<DocumentSummary[]>>;
  getDocument(id: DocumentId): Promise<ApiResult<DocumentDetail>>;
  getArgument(id: DocumentId): Promise<ApiResult<ArgumentGraph>>;
  getRun(id: RunId): Promise<ApiResult<AnalysisRun>>;
  /** Streams a run's events after `afterSequence` (`-1` for all of them). */
  subscribeRunEvents(runId: RunId, afterSequence: number, handlers: RunEventHandlers): Unsubscribe;
}

/** The subset of `EventSource` the client uses, so tests can supply their own. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

/** `EventSource.CLOSED`, which the browser enters when it has given up reconnecting. */
const CLOSED = 2;

export interface HttpApiClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly createEventSource?: (url: string) => EventSourceLike;
  /** Delay before reconnecting by hand after the browser gives up; doubles to `maxReconnectMs`. */
  readonly reconnectMs?: number;
  readonly maxReconnectMs?: number;
}

const NETWORK_FAILURE: ApiFailure = {
  code: 'network',
  message: 'The server could not be reached. Check that it is running and try again.',
};

export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly createEventSource: (url: string) => EventSourceLike;
  private readonly reconnectMs: number;
  private readonly maxReconnectMs: number;

  constructor(options: HttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    // Bound, because a detached `fetch` throws "Illegal invocation" in browsers.
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createEventSource = options.createEventSource ?? ((url) => new EventSource(url));
    this.reconnectMs = options.reconnectMs ?? 1000;
    this.maxReconnectMs = options.maxReconnectMs ?? 10_000;
  }

  submitDocument(request: CreateDocumentRequest): Promise<ApiResult<CreateDocumentResponse>> {
    return this.request(
      '/api/documents',
      { method: 'POST', body: JSON.stringify(request) },
      (json) => decodeWire(createDocumentResponseSchema, json),
    );
  }

  listDocuments(): Promise<ApiResult<DocumentSummary[]>> {
    return this.request('/api/documents', {}, (json) =>
      decodeWire(documentListResponseSchema, json),
    );
  }

  getDocument(id: DocumentId): Promise<ApiResult<DocumentDetail>> {
    return this.request(`/api/documents/${encodeURIComponent(id)}`, {}, (json) =>
      decodeWire(documentDetailResponseSchema, json),
    );
  }

  getArgument(id: DocumentId): Promise<ApiResult<ArgumentGraph>> {
    return this.request(
      `/api/documents/${encodeURIComponent(id)}/argument`,
      {},
      decodeArgumentResponse,
    );
  }

  getRun(id: RunId): Promise<ApiResult<AnalysisRun>> {
    return this.request(`/api/runs/${encodeURIComponent(id)}`, {}, (json) =>
      decodeWire(analysisRunWireSchema, json),
    );
  }

  subscribeRunEvents(runId: RunId, afterSequence: number, handlers: RunEventHandlers): Unsubscribe {
    let last = afterSequence;
    let source: EventSourceLike | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = this.reconnectMs;
    let stopped = false;

    const stop = (): void => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      source?.close();
    };

    const connect = (): void => {
      // `after` only matters for a connection this client opens; on its own
      // reconnects the browser sends `Last-Event-ID`, which the server prefers.
      const url = `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/events?after=${String(last)}`;
      const current = this.createEventSource(url);
      source = current;

      current.onopen = () => {
        delay = this.reconnectMs;
        handlers.onConnection?.('open');
      };

      current.onmessage = (message) => {
        const event = parseEvent(message.data);
        // A reconnect can replay what was already delivered; sequences are
        // monotonic, so anything not newer is a duplicate.
        if (event === null || event.sequence <= last) return;
        last = event.sequence;
        handlers.onEvent(event);
      };

      current.addEventListener(RUN_STREAM_END_EVENT, (message) => {
        const end = parseEnd(message.data);
        if (end === null) return;
        // Closed before the handler runs, so the browser never reconnects to a
        // stream the server has finished.
        stop();
        handlers.onEnd(end);
      });

      current.onerror = () => {
        if (stopped) return;
        handlers.onConnection?.('reconnecting');
        // While CONNECTING the browser is already retrying, with
        // `Last-Event-ID`. Once CLOSED it has given up, so retry by hand.
        if (current.readyState !== CLOSED) return;
        current.close();
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, this.maxReconnectMs);
      };
    };

    connect();
    return stop;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    decode: (json: unknown) => T,
  ): Promise<ApiResult<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      });
    } catch {
      return { ok: false, error: NETWORK_FAILURE };
    }

    const json: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const body = parseWire(apiErrorResponseSchema, json);
      return {
        ok: false,
        error: body.ok
          ? body.value.error
          : { code: 'internal', message: `The server responded with ${String(response.status)}.` },
      };
    }

    // A success body that breaks the contract is a bug, not a user error;
    // `decode` throws and the caller's error boundary reports it.
    return { ok: true, value: decode(json) };
  }
}

function parseEvent(data: string): RunEvent | null {
  try {
    return decodeWire(runEventWireSchema, JSON.parse(data));
  } catch {
    return null;
  }
}

function parseEnd(data: string): RunStreamEnd | null {
  try {
    return decodeWire(runStreamEndSchema, JSON.parse(data));
  } catch {
    return null;
  }
}
