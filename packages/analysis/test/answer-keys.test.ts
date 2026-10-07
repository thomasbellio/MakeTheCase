import { describe, expect, it } from 'vitest';
import { toView } from '@make-your-case/domain';
import { analyzeArgumentGraph } from '../src/analyze/analyze-argument-graph.ts';
import { KEYED_FIXTURES } from './fixtures/index.ts';
import { checkRange, readAnswerKey } from './answer-key.ts';

const SEVERITY_ORDER = { info: 0, warning: 1, critical: 2 } as const;

/**
 * Checks each hand-built fixture against the real answer key it mirrors.
 *
 * Only the expectations that are properties of the **graph** are asserted here.
 * `spans_with_function` and `claim_occurrences_in_function` are properties of
 * segmentation and classification: Phase 1 fixtures have no spans carrying a
 * discourse function, so asserting them from a hand-typed graph would prove
 * nothing. They are covered by `pnpm eval` in Phase 2 (AGENTS.md section 8.7).
 */
const SPAN_LEVEL_KEYS = new Set(['spans_with_function', 'claim_occurrences_in_function']);

describe.each(KEYED_FIXTURES.map((f) => [f.key ?? '?', f] as const))(
  'answer key %s',
  (stem, fixture) => {
    const key = readAnswerKey(stem);
    const findings = analyzeArgumentGraph(toView(fixture.graph));
    const { hard } = key;

    it('is the key for this fixture', () => {
      expect(key.id).toBe(stem);
      expect(key.expected_status).toBe('completed');
    });

    it('produces every required finding, at the required severity', () => {
      for (const required of hard.findings_present ?? []) {
        const matching = findings.filter((f) => f.kind === required.kind);
        expect(matching, `expected a ${required.kind} finding`).not.toHaveLength(0);
        if (required.severity !== undefined) {
          expect(
            matching.map((f) => f.severity),
            `expected a ${required.kind} at ${required.severity}`,
          ).toContain(required.severity);
        }
      }
    });

    it('produces none of the forbidden findings', () => {
      const produced = new Set(findings.map((f) => f.kind));
      for (const forbidden of hard.findings_absent ?? []) {
        expect(produced, `${forbidden} must not be reported`).not.toContain(forbidden);
      }
    });

    it('stays within the maximum severity', () => {
      if (hard.findings_max_severity === undefined) return;
      const ceiling = SEVERITY_ORDER[hard.findings_max_severity];
      for (const finding of findings) {
        expect(
          SEVERITY_ORDER[finding.severity],
          `${finding.kind} is more severe than ${hard.findings_max_severity}`,
        ).toBeLessThanOrEqual(ceiling);
      }
    });

    it('matches the expected counts', () => {
      const occurrences = new Map<string, number>();
      for (const o of fixture.graph.occurrences) {
        occurrences.set(o.claim_id, (occurrences.get(o.claim_id) ?? 0) + 1);
      }

      const problems = [
        checkRange('claim_count', fixture.graph.claims.length, hard.claim_count),
        checkRange('inference_count', fixture.graph.inferences.length, hard.inference_count),
        checkRange('relations_count', fixture.graph.relations.length, hard.relations_count),
        checkRange(
          'inferred_claims',
          fixture.graph.claims.filter((c) => c.origin === 'inferred').length,
          hard.inferred_claims,
        ),
        checkRange(
          'unsupported_claim_count',
          findings.filter((f) => f.kind === 'unsupported_claim').length,
          hard.unsupported_claim_count,
        ),
        checkRange(
          'max_occurrences_for_single_claim',
          Math.max(0, ...occurrences.values()),
          hard.max_occurrences_for_single_claim,
        ),
        checkRange(
          'claims_with_modality_not_asserted',
          fixture.graph.claims.filter((c) => c.modality !== 'asserted').length,
          hard.claims_with_modality_not_asserted,
        ),
      ].filter((p) => p !== null);

      expect(problems).toEqual([]);
    });

    it('contains every required relation type', () => {
      const present = new Set(fixture.graph.relations.map((r) => r.type));
      for (const required of hard.relations_present ?? []) {
        expect(present, `expected a ${required} relation`).toContain(required);
      }
    });

    it('leaves only span-level expectations unasserted', () => {
      // Guards the skip list: if a key gains a new hard expectation, this fails
      // rather than silently ignoring it.
      const asserted = new Set([
        'findings_present',
        'findings_absent',
        'findings_max_severity',
        'claim_count',
        'inference_count',
        'relations_count',
        'relations_present',
        'inferred_claims',
        'unsupported_claim_count',
        'max_occurrences_for_single_claim',
        'claims_with_modality_not_asserted',
        'argument_graph',
      ]);
      const unknown = Object.keys(hard).filter((k) => !asserted.has(k) && !SPAN_LEVEL_KEYS.has(k));
      expect(unknown).toEqual([]);
    });
  },
);
