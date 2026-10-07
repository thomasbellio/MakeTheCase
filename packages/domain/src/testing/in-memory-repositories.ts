import type { DocumentId, RevisionId, RunId } from '../ids.ts';
import { newId } from '../ids.ts';
import type { Document, DocumentSummary, NewDocument } from '../entities/document.ts';
import type { Span } from '../entities/span.ts';
import type {
  AnalysisRun,
  NewAnalysisRun,
  NewRunEvent,
  RunEvent,
  RunStatusUpdate,
} from '../entities/run.ts';
import type { ArgumentGraph } from '../graph/argument-graph.ts';
import type {
  AnalysisRunRepository,
  DocumentRepository,
  Repositories,
  RevisionRepository,
  SpanRepository,
} from '../repositories/index.ts';

/**
 * In-memory repository implementations for tests.
 *
 * These live in `domain` rather than `persistence` because `pipeline` may never
 * import `persistence` (AGENTS.md section 4), so this is the only package every
 * consumer can reach. They are plain `Map`s over domain types — no I/O, no
 * Drizzle — so the `domain → zod only` rule still holds.
 *
 * Use these instead of ad-hoc mocks: a hand-written fake typechecks against the
 * interface, so a signature change breaks the fake rather than silently
 * leaving a stub returning `undefined`.
 */

export class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<DocumentId, Document>();

  create(input: NewDocument): Promise<Document> {
    const document: Document = {
      id: newId<DocumentId>(),
      source_text: input.source_text,
      title: input.title,
      role: input.role,
      created_at: new Date(),
    };
    this.documents.set(document.id, document);
    return Promise.resolve(document);
  }

  getById(id: DocumentId): Promise<Document | null> {
    return Promise.resolve(this.documents.get(id) ?? null);
  }

  list(): Promise<DocumentSummary[]> {
    return Promise.resolve(
      [...this.documents.values()].map((d) => ({
        id: d.id,
        title: d.title,
        role: d.role,
        created_at: d.created_at,
        latest_run_status: null,
      })),
    );
  }
}

export class InMemorySpanRepository implements SpanRepository {
  readonly spans = new Map<DocumentId, Span[]>();

  saveAll(documentId: DocumentId, spans: Span[]): Promise<void> {
    this.spans.set(documentId, [...spans]);
    return Promise.resolve();
  }

  listByDocument(documentId: DocumentId): Promise<Span[]> {
    return Promise.resolve([...(this.spans.get(documentId) ?? [])]);
  }
}

export class InMemoryRevisionRepository implements RevisionRepository {
  readonly graphs = new Map<RevisionId, ArgumentGraph>();
  /** Insertion order per document, so `getLatestForDocument` has a defined answer. */
  readonly byDocument = new Map<DocumentId, RevisionId[]>();

  saveArgumentGraph(graph: ArgumentGraph): Promise<RevisionId> {
    this.graphs.set(graph.revision_id, graph);
    return Promise.resolve(graph.revision_id);
  }

  getArgumentGraph(revisionId: RevisionId): Promise<ArgumentGraph | null> {
    return Promise.resolve(this.graphs.get(revisionId) ?? null);
  }

  getLatestForDocument(documentId: DocumentId): Promise<ArgumentGraph | null> {
    const revisions = this.byDocument.get(documentId);
    const latest = revisions?.at(-1);
    return Promise.resolve(latest === undefined ? null : (this.graphs.get(latest) ?? null));
  }

  /** Test helper: records which document a revision belongs to. */
  linkToDocument(documentId: DocumentId, revisionId: RevisionId): void {
    const existing = this.byDocument.get(documentId);
    if (existing) {
      existing.push(revisionId);
    } else {
      this.byDocument.set(documentId, [revisionId]);
    }
  }
}

export class InMemoryAnalysisRunRepository implements AnalysisRunRepository {
  readonly runs = new Map<RunId, AnalysisRun>();
  readonly events = new Map<RunId, RunEvent[]>();

  create(input: NewAnalysisRun): Promise<AnalysisRun> {
    const run: AnalysisRun = {
      id: newId<RunId>(),
      document_id: input.document_id,
      revision_id: null,
      status: input.status,
      current_stage: null,
      summary: null,
      model_config: null,
      error: null,
      started_at: null,
      finished_at: null,
    };
    this.runs.set(run.id, run);
    return Promise.resolve(run);
  }

  updateStatus(id: RunId, update: RunStatusUpdate): Promise<void> {
    const existing = this.runs.get(id);
    if (existing === undefined) {
      return Promise.reject(new Error(`no run ${id}`));
    }
    // Only keys actually present in the patch are applied, so an explicit
    // `null` clears a field but an absent key leaves it alone.
    const patch = Object.fromEntries(
      Object.entries(update).filter(([, value]) => value !== undefined),
    );
    this.runs.set(id, { ...existing, ...patch });
    return Promise.resolve();
  }

  getById(id: RunId): Promise<AnalysisRun | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  appendEvent(event: NewRunEvent): Promise<RunEvent> {
    const existing = this.events.get(event.run_id) ?? [];
    const created: RunEvent = {
      id: newId(),
      run_id: event.run_id,
      sequence: existing.length,
      stage: event.stage,
      type: event.type,
      payload: event.payload,
      created_at: new Date(),
    };
    this.events.set(event.run_id, [...existing, created]);
    return Promise.resolve(created);
  }

  listEventsSince(runId: RunId, afterSequence: number): Promise<RunEvent[]> {
    const all = this.events.get(runId) ?? [];
    return Promise.resolve(all.filter((e) => e.sequence > afterSequence));
  }
}

/** A complete set of in-memory repositories, for injecting at a test's composition root. */
export function createInMemoryRepositories(): Repositories & {
  readonly documents: InMemoryDocumentRepository;
  readonly spans: InMemorySpanRepository;
  readonly revisions: InMemoryRevisionRepository;
  readonly runs: InMemoryAnalysisRunRepository;
} {
  return {
    documents: new InMemoryDocumentRepository(),
    spans: new InMemorySpanRepository(),
    revisions: new InMemoryRevisionRepository(),
    runs: new InMemoryAnalysisRunRepository(),
  };
}
