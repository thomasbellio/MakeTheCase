import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { newId, type DocumentId, type RunEventId, type RunId, type SpanId } from '../ids.ts';
import type { AnalysisRun, RunEvent } from '../entities/run.ts';
import type { Document } from '../entities/document.ts';
import {
  createDocumentRequestSchema,
  documentDetailResponseSchema,
  runEventWireSchema,
} from './api.ts';

const document: Document = {
  id: newId<DocumentId>(),
  source_text: 'The motion should be denied.',
  title: 'Opposition',
  role: 'own_brief',
  created_at: new Date('2026-10-01T12:00:00.000Z'),
};

const run: AnalysisRun = {
  id: newId<RunId>(),
  document_id: document.id,
  revision_id: null,
  status: 'running',
  current_stage: 'extract',
  summary: null,
  model_config: { stages: { extract: { provider: 'anthropic', model: 'm' } } },
  error: null,
  started_at: new Date('2026-10-01T12:00:01.000Z'),
  finished_at: null,
};

/** Encodes, then round-trips through JSON text, as the HTTP boundary does. */
function overTheWire<S extends z.ZodType>(schema: S, value: z.output<S>): z.output<S> {
  const text = JSON.stringify(z.encode(schema, value));
  return z.decode(schema, JSON.parse(text) as z.input<S>);
}

describe('API wire contracts', () => {
  it('round-trips a document detail, dates included, through JSON', () => {
    const detail = {
      document,
      spans: [
        {
          id: newId<SpanId>(),
          document_id: document.id,
          ordinal: 0,
          char_start: 0,
          char_end: 28,
          is_heading: false,
          function: 'argumentative' as const,
          function_confidence: 0.9,
        },
      ],
      latestRun: run,
    };

    const decoded = overTheWire(documentDetailResponseSchema, detail);

    expect(decoded).toEqual(detail);
    expect(decoded.document.created_at).toBeInstanceOf(Date);
  });

  it('encodes dates as ISO strings', () => {
    const encoded = z.encode(documentDetailResponseSchema, {
      document,
      spans: [],
      latestRun: null,
    });
    expect(encoded.document.created_at).toBe('2026-10-01T12:00:00.000Z');
  });

  it('round-trips a run event', () => {
    const event: RunEvent = {
      id: newId<RunEventId>(),
      run_id: run.id,
      sequence: 3,
      stage: 'classify',
      type: 'stage_progress',
      payload: { message: 'Classified 4 of 9 spans', classified: 4, total: 9 },
      created_at: new Date('2026-10-01T12:00:02.000Z'),
    };
    expect(overTheWire(runEventWireSchema, event)).toEqual(event);
  });

  it('rejects a submission with only whitespace', () => {
    expect(createDocumentRequestSchema.safeParse({ sourceText: '  \n ' }).success).toBe(false);
  });

  it('accepts a submission with only text', () => {
    expect(createDocumentRequestSchema.parse({ sourceText: 'An argument.' })).toEqual({
      sourceText: 'An argument.',
    });
  });
});
