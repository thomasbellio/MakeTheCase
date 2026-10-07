import { z } from 'zod';

/**
 * Environment configuration, shared by every app.
 *
 * AGENTS.md section 10 requires config to be parsed and validated with Zod at
 * startup in each app, failing fast on invalid values. Defining the schema once
 * here keeps the two composition roots (`apps/web`, `apps/worker`) in agreement.
 *
 * The LLM settings are optional in v1 so the web app and worker start without
 * any API key. Phase 2 introduces a stricter, provider-aware refinement for the
 * pipeline, which is the only consumer that actually needs a key.
 */
export const envSchema = z.object({
  DATABASE_URL: z.url('DATABASE_URL must be a valid postgres:// URL'),

  LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  LLM_MODEL_DEFAULT: z.string().optional(),
  LLM_MODEL_CLASSIFY: z.string().optional(),
  LLM_MODEL_EXTRACT: z.string().optional(),
  LLM_MODEL_RECONSTRUCT: z.string().optional(),

  LLM_MODEL_JUDGE: z.string().optional(),

  MAX_DOCUMENT_CHARS: z.coerce.number().int().positive().default(200_000),
  PIPELINE_MAX_VALIDATION_RETRIES: z.coerce.number().int().min(0).default(3),
  GATE_MIN_ARGUMENTATIVE_SPANS: z.coerce.number().int().min(1).default(2),

  // `pnpm test:db` only (AGENTS.md section 7.6). Optional so neither app
  // requires it to start.
  TEST_DATABASE_URL: z.url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates environment configuration.
 *
 * Throws with a readable, multi-line summary of every invalid variable. The
 * message deliberately names only the offending keys, never their values, so a
 * misconfigured secret cannot leak into logs (AGENTS.md section 10).
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
