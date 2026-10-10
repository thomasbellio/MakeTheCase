import type { DocumentId, RunId } from '../ids.ts';
import type {
  AnalysisRun,
  NewAnalysisRun,
  NewRunEvent,
  RunEvent,
  RunStatusUpdate,
} from '../entities/run.ts';

export interface AnalysisRunRepository {
  create(input: NewAnalysisRun): Promise<AnalysisRun>;
  updateStatus(id: RunId, update: RunStatusUpdate): Promise<void>;
  getById(id: RunId): Promise<AnalysisRun | null>;
  /** The document's most recently requested run, whatever its status; null if it has none. */
  getLatestForDocument(documentId: DocumentId): Promise<AnalysisRun | null>;
  appendEvent(event: NewRunEvent): Promise<RunEvent>;
  listEventsSince(runId: RunId, afterSequence: number): Promise<RunEvent[]>;
}
