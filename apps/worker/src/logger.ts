/**
 * Structured JSON logging (AGENTS.md section 11).
 *
 * Phase 2 extends each record with `runId` and `stage`. Document text, prompts
 * and model output must never be logged at info level.
 */
type Level = 'info' | 'warn' | 'error';

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const record = {
    level,
    time: new Date().toISOString(),
    service: 'worker',
    message,
    ...fields,
  };
  const line = JSON.stringify(record);

  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}
