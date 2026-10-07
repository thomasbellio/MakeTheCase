import type { SegmentedSpan } from './segment.ts';

/** A span counts towards the gate only when classified argumentative at least this confidently. */
export const GATE_CONFIDENCE_THRESHOLD = 0.5;

export function countArgumentative(
  spans: readonly SegmentedSpan[],
  threshold = GATE_CONFIDENCE_THRESHOLD,
): number {
  return spans.filter(
    ({ span }) => span.function === 'argumentative' && (span.function_confidence ?? 0) >= threshold,
  ).length;
}

/**
 * The gate after classification (AGENTS.md section 8.2): too few confidently
 * argumentative spans ends the run as `not_an_argument`.
 */
export function passesGate(
  spans: readonly SegmentedSpan[],
  minimumArgumentativeSpans: number,
): boolean {
  return countArgumentative(spans) >= minimumArgumentativeSpans;
}
