import type { DocumentId, LocalId, RevisionId, RunId } from '../ids.ts';
import type { DraftSpan } from '../entities/span.ts';
import type { AnalysisFinding } from '../entities/finding.ts';
import type { ArgumentGraph, ArgumentGraphDraft } from '../graph/argument-graph.ts';

/** Everything a successful pipeline run produces, still in local IDs. */
export interface AnalysisResult {
  readonly documentId: DocumentId;
  readonly runId: RunId;
  readonly spans: readonly DraftSpan[];
  readonly draft: ArgumentGraphDraft;
  readonly findings: readonly AnalysisFinding<LocalId>[];
}

export interface RevisionRepository {
  /**
   * Writes a graph's contents — claims, occurrences, inferences, premises,
   * relations, findings — in one transaction, into a revision row that must
   * already exist (`ArgumentGraph` does not carry the document the revision
   * belongs to). The pipeline saves through `saveAnalysisResult` instead.
   */
  saveArgumentGraph(graph: ArgumentGraph): Promise<RevisionId>;
  getArgumentGraph(revisionId: RevisionId): Promise<ArgumentGraph | null>;
  getLatestForDocument(documentId: DocumentId): Promise<ArgumentGraph | null>;
  /**
   * Persists a completed run in one transaction (AGENTS.md section 8.2,
   * `persist`): upserts the document's spans, creates a `system` revision,
   * maps local IDs to UUIDs, writes the graph and links the revision to the run.
   *
   * Spans are matched by ordinal and keep their IDs, so occurrences in earlier
   * revisions stay valid when a document is analyzed again. Idempotent per
   * run: if the run already has a revision, that revision is returned and
   * nothing is written, so a workflow resumed after a crash between commit and
   * checkpoint cannot save twice.
   */
  saveAnalysisResult(result: AnalysisResult): Promise<RevisionId>;
}
