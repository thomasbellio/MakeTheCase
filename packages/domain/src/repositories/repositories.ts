import type { AnalysisRunRepository } from './analysis-run-repository.ts';
import type { DocumentRepository } from './document-repository.ts';
import type { RevisionRepository } from './revision-repository.ts';
import type { SpanRepository } from './span-repository.ts';

/** Every repository a composition root must provide. */
export interface Repositories {
  readonly documents: DocumentRepository;
  readonly spans: SpanRepository;
  readonly revisions: RevisionRepository;
  readonly runs: AnalysisRunRepository;
}
