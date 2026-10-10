import { describe, expect, it } from 'vitest';
import { newId, type RunEventId, type RunId } from '@make-your-case/domain';
import { errorResponse, formatItem, resumeSequence, sseResponse } from './http.ts';
import type { RunStreamItem } from './services/run-service.ts';

const event = (sequence: number): RunStreamItem => ({
  kind: 'event',
  event: {
    id: newId<RunEventId>(),
    run_id: newId<RunId>(),
    sequence,
    stage: 'extract',
    type: 'stage_started',
    payload: null,
    created_at: new Date('2026-10-01T00:00:00.000Z'),
  },
});

describe('resumeSequence', () => {
  const request = (url: string, headers: Record<string, string> = {}): Request =>
    new Request(url, { headers });

  it('starts from the beginning by default', () => {
    expect(resumeSequence(request('http://x/api/runs/1/events'))).toBe(-1);
  });

  it('prefers Last-Event-ID, which the browser sends on reconnect', () => {
    expect(resumeSequence(request('http://x/events?after=2', { 'last-event-id': '7' }))).toBe(7);
  });

  it('falls back to ?after=', () => {
    expect(resumeSequence(request('http://x/events?after=4'))).toBe(4);
  });

  it('ignores a value that is not an integer', () => {
    expect(resumeSequence(request('http://x/events?after=abc'))).toBe(-1);
    expect(resumeSequence(request('http://x/events?after=-9'))).toBe(-1);
  });
});

describe('Server-Sent Events', () => {
  it('formats an event with its sequence as the id', () => {
    const text = formatItem(event(3));
    expect(text).toMatch(/^id: 3\ndata: \{.*\}\n\n$/);
    expect(JSON.parse(text.split('data: ')[1] ?? '')).toMatchObject({
      sequence: 3,
      created_at: '2026-10-01T00:00:00.000Z',
    });
  });

  it('formats the end of the stream as a named event', () => {
    expect(formatItem({ kind: 'end', status: 'completed' })).toBe(
      'event: end\ndata: {"status":"completed"}\n\n',
    );
  });

  it('streams items in order and closes', async () => {
    async function* items(): AsyncGenerator<RunStreamItem, void> {
      await Promise.resolve();
      yield event(0);
      yield event(1);
      yield { kind: 'end', status: 'not_an_argument' };
    }

    const response = sseResponse(items());

    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const body = await response.text();
    expect(body.match(/^id: \d+/gm)).toEqual(['id: 0', 'id: 1']);
    expect(body.endsWith('event: end\ndata: {"status":"not_an_argument"}\n\n')).toBe(true);
  });
});

describe('errorResponse', () => {
  it.each([
    ['validation_failed', 400],
    ['not_found', 404],
    ['document_too_large', 413],
    ['internal', 500],
  ] as const)('maps %s to %i', async (code, status) => {
    const response = errorResponse({ code, message: 'm' });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: 'm' } });
  });
});
