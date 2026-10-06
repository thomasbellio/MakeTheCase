import { parseEnv } from '@make-your-case/domain';
import { log } from './logger.ts';

/**
 * Worker composition root.
 *
 * Phase 2 (AGENTS.md section 8.4) turns this into a pg-boss consumer for
 * `analyze-document` jobs that builds the repositories, provider factory and
 * progress reporter, then runs the LangGraph workflow. For now it proves that
 * config parsing fails fast and that the workspace packages resolve.
 */
function main(): void {
  let env;
  try {
    env = parseEnv();
  } catch (error) {
    log('error', 'invalid configuration', { error: (error as Error).message });
    process.exit(1);
  }

  log('info', 'worker scaffold ready', {
    // Logged to confirm env vars survive Turborepo's strict env mode. Never log
    // DATABASE_URL or any API key.
    llmProvider: env.LLM_PROVIDER,
    maxDocumentChars: env.MAX_DOCUMENT_CHARS,
    maxValidationRetries: env.PIPELINE_MAX_VALIDATION_RETRIES,
  });
}

main();
