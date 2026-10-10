import type { ApiError } from '@make-your-case/domain';

/**
 * What a service returns for an expected failure (AGENTS.md section 11):
 * a typed error the HTTP layer maps to a status, never an exception.
 */
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });

export const fail = <T = never>(code: ApiError['code'], message: string): ServiceResult<T> => ({
  ok: false,
  error: { code, message },
});
