import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/**
 * A minimal reader for the answer keys in `fixtures/arguments/`.
 *
 * Knowingly temporary: AGENTS.md section 8.7 puts the real Zod schema in
 * `tools/eval` in Phase 2, and this is replaced by it. It exists now so the
 * Phase 1 fixtures are checked against the actual keys rather than against
 * expectations retyped by hand — retyped expectations drift silently, which is
 * the failure this is meant to prevent.
 */

export interface Range {
  readonly min?: number;
  readonly max?: number;
}

export interface HardExpectations {
  readonly argument_graph?: 'absent';
  readonly findings_present?: readonly { readonly kind: string; readonly severity?: string }[];
  readonly findings_absent?: readonly string[];
  readonly findings_max_severity?: 'info' | 'warning' | 'critical';
  readonly claim_count?: Range;
  readonly inference_count?: Range;
  readonly relations_count?: Range;
  readonly relations_present?: readonly string[];
  readonly inferred_claims?: Range;
  readonly unsupported_claim_count?: Range;
  readonly max_occurrences_for_single_claim?: Range;
  readonly claims_with_modality_not_asserted?: Range;
  readonly spans_with_function?: Readonly<Record<string, Range>>;
  readonly claim_occurrences_in_function?: Readonly<Record<string, Range>>;
}

export interface AnswerKey {
  readonly id: string;
  readonly expected_status: 'completed' | 'not_an_argument';
  readonly thesis: string | null;
  readonly hard: HardExpectations;
  readonly notes?: string;
}

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/arguments/', import.meta.url));

export function readAnswerKey(stem: string): AnswerKey {
  const text = readFileSync(`${FIXTURES_DIR}${stem}.expected.yaml`, 'utf8');
  const parsed: unknown = parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${stem}.expected.yaml did not parse to an object`);
  }
  return parsed as AnswerKey;
}

/** Checks a count against a `{ min?, max? }` range. Returns a reason on failure. */
export function checkRange(label: string, actual: number, range: Range | undefined): string | null {
  if (range === undefined) return null;
  if (range.min !== undefined && actual < range.min) {
    return `${label}: ${String(actual)} is below the minimum ${String(range.min)}`;
  }
  if (range.max !== undefined && actual > range.max) {
    return `${label}: ${String(actual)} is above the maximum ${String(range.max)}`;
  }
  return null;
}
