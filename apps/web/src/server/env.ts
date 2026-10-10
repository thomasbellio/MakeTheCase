import { parseEnv, type Env } from '@make-your-case/domain';

let cached: Env | undefined;

/**
 * The API's configuration, parsed once on first use (AGENTS.md section 10).
 *
 * Lazily rather than at import, so that `next build` — which imports every
 * route — does not need a database URL. A bad value still fails the first
 * request loudly, naming the variable and never its value.
 */
export function serverEnv(): Env {
  cached ??= parseEnv();
  return cached;
}
