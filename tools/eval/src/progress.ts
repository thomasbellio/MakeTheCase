import type { PipelineStage } from '@make-your-case/domain';
import type { ProgressReporter } from '@make-your-case/pipeline';

/**
 * Prints progress to stderr and records stage timings.
 *
 * A fourteen-fixture billed run must not be silent — without this you cannot
 * tell a slow `reconstruct` from a hung one. stderr, so `report.md` on stdout
 * stays pipeable.
 */
export class ConsoleProgressReporter implements ProgressReporter {
  readonly durations = new Map<PipelineStage, number>();
  /** The last stage to start, so a thrown error can be attributed to it. */
  lastStage: PipelineStage | null = null;
  retries = 0;

  private readonly startedAt = new Map<PipelineStage, number>();

  private readonly label: string;
  private readonly write: (line: string) => void;

  constructor(label: string, write: (line: string) => void = (line) => process.stderr.write(line)) {
    this.label = label;
    this.write = write;
  }

  private line(text: string): void {
    this.write(`  ${this.label} ${text}\n`);
  }

  stageStarted(stage: PipelineStage): Promise<void> {
    this.lastStage = stage;
    this.startedAt.set(stage, Date.now());
    this.line(`${stage}…`);
    return Promise.resolve();
  }

  // `data` is for machine-readable events; this reporter prints the message.
  stageProgress(stage: PipelineStage, message: string): Promise<void> {
    this.line(`${stage}: ${message}`);
    return Promise.resolve();
  }

  stageCompleted(stage: PipelineStage): Promise<void> {
    const started = this.startedAt.get(stage);
    if (started !== undefined) this.durations.set(stage, Date.now() - started);
    return Promise.resolve();
  }

  validationRetry(attempt: number, errorCount: number): Promise<void> {
    this.retries += 1;
    this.line(
      `validation failed with ${String(errorCount)} error(s); retrying (attempt ${String(attempt)})`,
    );
    return Promise.resolve();
  }

  runFailed(message: string): Promise<void> {
    this.line(`failed: ${message}`);
    return Promise.resolve();
  }
}
