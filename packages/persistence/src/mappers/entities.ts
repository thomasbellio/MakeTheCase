import type {
  AnalysisRun,
  Document,
  DocumentId,
  RevisionId,
  RunEvent,
  RunId,
  Span,
  SpanId,
} from '@make-your-case/domain';
import type { analysisRuns, documents, runEvents, spans } from '../schema/tables.ts';

/**
 * Row <-> domain mappers (AGENTS.md section 5.1).
 *
 * Drizzle row types never leave this package, so every crossing happens here.
 * The mappers are explicit rather than generic: the column names are snake_case
 * and the branded IDs are opaque strings at runtime, so there is nothing to
 * infer and a wrong field would be silent.
 */

type DocumentRow = typeof documents.$inferSelect;
type SpanRow = typeof spans.$inferSelect;
type RunRow = typeof analysisRuns.$inferSelect;
type RunEventRow = typeof runEvents.$inferSelect;

export function documentToDomain(row: DocumentRow): Document {
  return {
    id: row.id as DocumentId,
    source_text: row.sourceText,
    title: row.title,
    role: row.role,
    created_at: row.createdAt,
  };
}

export function spanToDomain(row: SpanRow): Span {
  return {
    id: row.id as SpanId,
    document_id: row.documentId as DocumentId,
    ordinal: row.ordinal,
    char_start: row.charStart,
    char_end: row.charEnd,
    is_heading: row.isHeading,
    function: row.function,
    function_confidence: row.functionConfidence,
  };
}

export function spanToRow(span: Span): typeof spans.$inferInsert {
  return {
    id: span.id,
    documentId: span.document_id,
    ordinal: span.ordinal,
    charStart: span.char_start,
    charEnd: span.char_end,
    isHeading: span.is_heading,
    function: span.function,
    functionConfidence: span.function_confidence,
  };
}

export function runToDomain(row: RunRow): AnalysisRun {
  return {
    id: row.id as RunId,
    document_id: row.documentId as DocumentId,
    revision_id: row.revisionId as RevisionId | null,
    status: row.status,
    current_stage: row.currentStage,
    summary: row.summary,
    // jsonb is `unknown` to Drizzle; the domain schema validates it on read
    // where that matters, and the pipeline is the only writer.
    model_config: row.modelConfig as Record<string, unknown> | null,
    error: row.error,
    started_at: row.startedAt,
    finished_at: row.finishedAt,
  };
}

export function runEventToDomain(row: RunEventRow): RunEvent {
  return {
    id: row.id as RunEvent['id'],
    run_id: row.runId as RunId,
    sequence: row.sequence,
    stage: row.stage,
    type: row.type,
    payload: row.payload as Record<string, unknown> | null,
    created_at: row.createdAt,
  };
}
