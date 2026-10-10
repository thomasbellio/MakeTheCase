import { PgBoss } from 'pg-boss';
import { ANALYZE_DOCUMENT_QUEUE, type AnalyzeDocumentJob } from '@make-your-case/domain';
import { log } from './logger.ts';

/** The enqueue side of the queue contract in `domain` (AGENTS.md section 8.5). */
export interface JobQueue {
  enqueueAnalyzeDocument(job: AnalyzeDocumentJob): Promise<void>;
}

/**
 * pg-boss, started on first use rather than at import, so `next build` and
 * pages that never enqueue do not need a database.
 */
export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;
  private ready: Promise<void> | undefined;

  constructor(connectionString: string) {
    this.boss = new PgBoss(connectionString);
    this.boss.on('error', (error: Error) => {
      log('error', 'queue error', { error: error.message });
    });
  }

  async enqueueAnalyzeDocument(job: AnalyzeDocumentJob): Promise<void> {
    await this.start();
    // Only identifiers travel on the queue; the document is already stored.
    await this.boss.send(ANALYZE_DOCUMENT_QUEUE, { documentId: job.documentId, runId: job.runId });
  }

  async stop(): Promise<void> {
    if (this.ready !== undefined) await this.boss.stop({ graceful: false });
  }

  private start(): Promise<void> {
    this.ready ??= (async () => {
      await this.boss.start();
      // Required before a job can be sent in pg-boss 12.
      await this.boss.createQueue(ANALYZE_DOCUMENT_QUEUE);
    })().catch((error: unknown) => {
      // Forget the failure, so a later submission retries rather than
      // replaying a rejected promise for the life of the process.
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }
}
