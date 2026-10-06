import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';

const valid = { DATABASE_URL: 'postgres://user:pw@localhost:5432/db' };

describe('parseEnv', () => {
  it('accepts a minimal configuration and applies defaults', () => {
    const env = parseEnv(valid);

    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.LLM_PROVIDER).toBe('anthropic');
    expect(env.MAX_DOCUMENT_CHARS).toBe(200_000);
    expect(env.PIPELINE_MAX_VALIDATION_RETRIES).toBe(3);
  });

  it('coerces numeric variables from strings', () => {
    const env = parseEnv({ ...valid, MAX_DOCUMENT_CHARS: '5000' });
    expect(env.MAX_DOCUMENT_CHARS).toBe(5000);
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects an unknown LLM provider', () => {
    expect(() => parseEnv({ ...valid, LLM_PROVIDER: 'nope' })).toThrow(/LLM_PROVIDER/);
  });

  it('does not include offending values in the error message', () => {
    const secret = 'super-secret-value';
    try {
      parseEnv({ ...valid, MAX_DOCUMENT_CHARS: secret });
      throw new Error('expected parseEnv to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
