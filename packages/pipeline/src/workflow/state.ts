import { Annotation } from '@langchain/langgraph';
import type {
  AnalysisFinding,
  ArgumentGraphDraft,
  DocumentId,
  LocalId,
  RevisionId,
  RunId,
} from '@make-your-case/domain';
import type { ExtractResponse, ReconstructResponse } from '../schemas/wire.ts';
import type { SegmentedSpan } from '../stages/segment.ts';

const value = <T>(initial: T) =>
  Annotation<T>({ reducer: (_previous, next) => next, default: () => initial });

/**
 * The workflow's state (AGENTS.md section 8.2). Every channel holds the latest
 * value written to it. Everything here is plain data, because the Postgres
 * checkpointer serializes it after each node so a crashed run can resume.
 */
export const AnalysisState = Annotation.Root({
  runId: Annotation<RunId>(),
  documentId: Annotation<DocumentId>(),
  sourceText: Annotation<string>(),

  spans: value<SegmentedSpan[]>([]),
  extracted: value<ExtractResponse | null>(null),
  /** The latest reconstruct response, kept in wire form so a retry can show the model what it produced. */
  reconstruction: value<ReconstructResponse | null>(null),
  draft: value<ArgumentGraphDraft | null>(null),
  /** Reconstruct calls made so far, including the first. */
  attempts: value(0),
  /** Feedback from the latest validation; empty once the draft is valid. */
  errors: value<string[]>([]),
  findings: value<AnalysisFinding<LocalId>[]>([]),

  outcome: value<'completed' | 'not_an_argument' | 'failed' | null>(null),
  summary: value<string | null>(null),
  revisionId: value<RevisionId | null>(null),
  failureMessage: value<string | null>(null),
});

export type AnalysisStateValue = typeof AnalysisState.State;
export type AnalysisStateUpdate = typeof AnalysisState.Update;
