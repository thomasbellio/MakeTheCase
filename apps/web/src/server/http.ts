import {
  apiErrorResponseSchema,
  encodeWire,
  RUN_STREAM_END_EVENT,
  runEventWireSchema,
  runStreamEndSchema,
  type ApiError,
  type WireOutput,
  type WireSchema,
} from '@make-your-case/domain';
import type { ServiceResult } from './services/result.ts';
import type { RunStreamItem } from './services/run-service.ts';

/**
 * Response helpers that keep route handlers to a few lines (AGENTS.md
 * section 2). Every body goes through a contract schema from `domain`, so the
 * server cannot send a shape the client would refuse.
 */

const STATUS: Record<ApiError['code'], number> = {
  validation_failed: 400,
  not_found: 404,
  document_too_large: 413,
  internal: 500,
};

export function json<S extends WireSchema>(
  schema: S,
  value: WireOutput<S>,
  status = 200,
): Response {
  return Response.json(encodeWire(schema, value), { status });
}

export function errorResponse(error: ApiError): Response {
  return Response.json(encodeWire(apiErrorResponseSchema, { error }), {
    status: STATUS[error.code],
  });
}

export function resultResponse<S extends WireSchema>(
  result: ServiceResult<WireOutput<S>>,
  schema: S,
  status = 200,
): Response {
  return result.ok ? json(schema, result.value, status) : errorResponse(result.error);
}

/** A request body that is not JSON at all is a validation failure, not a crash. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Where a client wants the event stream to resume: after the `Last-Event-ID`
 * the browser sends on an automatic reconnect, or after `?after=` when the
 * client reconnects by hand (a new `EventSource` cannot set the header).
 * `-1` means from the start, since sequences begin at 0.
 */
export function resumeSequence(request: Request): number {
  const raw =
    request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('after');
  if (raw === null || !/^-?\d+$/.test(raw.trim())) return -1;
  return Math.max(-1, Number.parseInt(raw, 10));
}

/**
 * Renders a run's stream as Server-Sent Events: one unnamed event per
 * `RunEvent` with `id:` set to its sequence, then a final `end` event, after
 * which the stream closes.
 */
export function sseResponse(items: AsyncGenerator<RunStreamItem, void>): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await items.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(formatItem(next.value)));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      // The client went away; stop polling.
      await items.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Stops a buffering proxy from holding events back.
      'x-accel-buffering': 'no',
    },
  });
}

export function formatItem(item: RunStreamItem): string {
  if (item.kind === 'end') {
    const data = JSON.stringify(encodeWire(runStreamEndSchema, { status: item.status }));
    return `event: ${RUN_STREAM_END_EVENT}\ndata: ${data}\n\n`;
  }
  const data = JSON.stringify(encodeWire(runEventWireSchema, item.event));
  return `id: ${String(item.event.sequence)}\ndata: ${data}\n\n`;
}
