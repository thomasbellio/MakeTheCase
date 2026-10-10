/**
 * Structured JSON logging for the API (AGENTS.md section 11), in the same shape
 * as the worker's. Document text, prompts and model output are never logged.
 */
type Level = 'info' | 'warn' | 'error';

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: 'web',
    message,
    ...fields,
  });

  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}
