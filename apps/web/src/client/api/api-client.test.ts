import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, type DocumentId, type RunId } from '@make-your-case/domain';
import { HttpApiClient, type EventSourceLike, type RunEventHandlers } from './api-client.ts';

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  readonly url: string;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  message(sequence: number): void {
    const data = JSON.stringify({
      id: newId(),
      run_id: newId(),
      sequence,
      stage: 'classify',
      type: 'stage_progress',
      payload: { message: `event ${String(sequence)}` },
      created_at: '2026-10-01T00:00:00.000Z',
    });
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  end(status: string): void {
    const event = new MessageEvent('end', { data: JSON.stringify({ status }) });
    for (const listener of this.listeners.get('end') ?? []) listener(event);
  }

  fail(readyState: number): void {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }
}

function recordingHandlers() {
  const log: string[] = [];
  const handlers: RunEventHandlers = {
    onEvent: (event) => log.push(`event ${String(event.sequence)}`),
    onEnd: (end) => log.push(`end ${end.status}`),
    onConnection: (state) => log.push(state),
  };
  return { log, handlers };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpApiClient requests', () => {
  it('decodes a success body, turning wire dates into Dates', async () => {
    const id = newId<DocumentId>();
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse([
          {
            id,
            title: null,
            role: 'other',
            created_at: '2026-10-01T00:00:00.000Z',
            latest_run_status: 'completed',
          },
        ]),
      ),
    );

    const result = await new HttpApiClient({ fetch }).listDocuments();

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value[0]?.created_at).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(fetch).toHaveBeenCalledWith('/api/documents', expect.anything());
  });

  it('posts a submission as JSON', async () => {
    const response = { documentId: newId<DocumentId>(), runId: newId<RunId>() };
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(jsonResponse(response, 201)),
    );

    const result = await new HttpApiClient({ fetch }).submitDocument({
      sourceText: 'An argument.',
    });

    expect(result).toEqual({ ok: true, value: response });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"sourceText":"An argument."}');
  });

  it("passes the server's error through", async () => {
    const error = { code: 'document_too_large', message: 'The text is too long.' };
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(jsonResponse({ error }, 413)),
    );

    expect(await new HttpApiClient({ fetch }).submitDocument({ sourceText: 'x' })).toEqual({
      ok: false,
      error,
    });
  });

  it('reports an error status without a contract body generically', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response('Bad gateway', { status: 502 })),
    );

    expect(await new HttpApiClient({ fetch }).getRun(newId<RunId>())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'The server responded with 502.' },
    });
  });

  it('reports an unreachable server as a network failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new TypeError('failed')));

    const result = await new HttpApiClient({ fetch }).getDocument(newId<DocumentId>());

    expect(result).toMatchObject({ ok: false, error: { code: 'network' } });
  });
});

describe('HttpApiClient run events', () => {
  let sources: FakeEventSource[];
  let client: HttpApiClient;
  const runId = newId<RunId>();

  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    client = new HttpApiClient({
      createEventSource: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
      reconnectMs: 100,
      maxReconnectMs: 300,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const latest = (): FakeEventSource => {
    const source = sources.at(-1);
    if (source === undefined) throw new Error('no event source was opened');
    return source;
  };

  it('opens the stream after the given sequence and delivers events in order', () => {
    const { log, handlers } = recordingHandlers();
    client.subscribeRunEvents(runId, 4, handlers);

    expect(latest().url).toBe(`/api/runs/${runId}/events?after=4`);
    latest().open();
    latest().message(5);
    latest().message(6);

    expect(log).toEqual(['open', 'event 5', 'event 6']);
  });

  it('drops events it has already delivered', () => {
    const { log, handlers } = recordingHandlers();
    client.subscribeRunEvents(runId, -1, handlers);

    latest().message(0);
    latest().message(1);
    latest().message(1);
    latest().message(0);

    expect(log).toEqual(['event 0', 'event 1']);
  });

  it('closes on the end event, so the browser does not reconnect', () => {
    const { log, handlers } = recordingHandlers();
    client.subscribeRunEvents(runId, -1, handlers);

    latest().message(0);
    latest().end('completed');

    expect(log).toEqual(['event 0', 'end completed']);
    expect(latest().closed).toBe(true);
  });

  it('leaves reconnection to the browser while it is retrying', () => {
    const { log, handlers } = recordingHandlers();
    client.subscribeRunEvents(runId, -1, handlers);

    latest().fail(0);
    vi.advanceTimersByTime(1000);

    expect(sources).toHaveLength(1);
    expect(log).toEqual(['reconnecting']);
  });

  it('reconnects by hand from the last delivered event once the browser gives up', () => {
    const { log, handlers } = recordingHandlers();
    client.subscribeRunEvents(runId, -1, handlers);
    latest().message(0);
    latest().message(1);

    latest().fail(2);
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(100);

    expect(sources).toHaveLength(2);
    expect(latest().url).toBe(`/api/runs/${runId}/events?after=1`);
    latest().open();
    latest().message(2);
    expect(log).toEqual(['event 0', 'event 1', 'reconnecting', 'open', 'event 2']);
  });

  it('backs off between attempts, up to the maximum', () => {
    const { handlers } = recordingHandlers();
    client.subscribeRunEvents(runId, -1, handlers);

    latest().fail(2);
    vi.advanceTimersByTime(100);
    latest().fail(2);
    vi.advanceTimersByTime(199);
    expect(sources).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(3);
    latest().fail(2);
    vi.advanceTimersByTime(300);
    expect(sources).toHaveLength(4);
  });

  it('stops reconnecting once unsubscribed', () => {
    const { handlers } = recordingHandlers();
    const unsubscribe = client.subscribeRunEvents(runId, -1, handlers);

    latest().fail(2);
    unsubscribe();
    vi.advanceTimersByTime(10_000);

    expect(sources).toHaveLength(1);
    expect(latest().closed).toBe(true);
  });
});
