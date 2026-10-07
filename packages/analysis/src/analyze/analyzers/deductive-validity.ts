import type { AnalysisFinding, FindingTarget } from '@make-your-case/domain';
import { entails, MAX_ATOMS } from '../../logic/entail.ts';
import type { Assignment } from '../../logic/formula.ts';
import { producedBy, type AnalysisContext, type Analyzer } from '../analyzer.ts';
import { claimText, list, q } from '../explain.ts';

/**
 * Whether each formalized deductive step actually follows.
 *
 * Only the author's own inferences are checked. Reconstruction models the other
 * party's reasoning so that an undercutting attack has something to point at
 * (AGENTS.md section 8.3, rule 7); that reconstruction is not the user's
 * argument and is not graded here.
 *
 * A step that is checked and holds produces no finding — there is no
 * `valid_step` kind, and absence is the encoding. A step that could not be
 * checked produces `unchecked_step`, never `invalid_step`.
 */
export const deductiveValidityAnalyzer: Analyzer<string> = {
  name: 'deductive-validity',
  version: '1.0.0',

  run<Id extends string>(ctx: AnalysisContext<Id>): readonly AnalysisFinding<Id>[] {
    const findings: AnalysisFinding<Id>[] = [];

    for (const inference of ctx.graph.inferences) {
      if (inference.scheme !== 'deductive') continue;
      if (!ctx.support.authorInferenceIds.has(inference.id)) continue;

      const unchecked = (reason: string): AnalysisFinding<Id> => ({
        kind: 'unchecked_step',
        severity: 'info',
        explanation: reason,
        produced_by: producedBy(deductiveValidityAnalyzer),
        targets: [{ target: 'inference', inference_id: inference.id, ordinal: 0 }],
      });

      const formalization = inference.formalization;
      if (formalization === null) {
        findings.push(
          unchecked(
            'This deductive step was not checked for formal validity because no propositional ' +
              'formalization is attached. It may still be sound.',
          ),
        );
        continue;
      }

      const result = entails(formalization.premises, formalization.conclusion);
      if (result.ok) continue;

      if (result.reason === 'too_many_atoms') {
        findings.push(
          unchecked(
            `This deductive step was not checked for formal validity: its formalization uses ` +
              `${String(result.atomCount)} distinct propositions, more than the ${String(MAX_ATOMS)} ` +
              `this check handles.`,
          ),
        );
        continue;
      }

      const premiseIds = ctx.index.premisesOf.get(inference.id) ?? [];
      const targets: FindingTarget<Id>[] = [
        { target: 'inference', inference_id: inference.id, ordinal: 0 },
        { target: 'claim', claim_id: inference.conclusion_claim_id, ordinal: 1 },
        ...premiseIds.map((id, i): FindingTarget<Id> => ({
          target: 'claim',
          claim_id: id,
          ordinal: i + 2,
        })),
      ];

      findings.push({
        kind: 'invalid_step',
        severity: 'critical',
        explanation:
          `The step to ${q(claimText(ctx, inference.conclusion_claim_id))} does not follow from its ` +
          `premises as the text states them. There is a case in which every premise holds and the ` +
          `conclusion does not: ${renderAssignment(ctx, formalization.atoms, result.counterexample)}.`,
        produced_by: producedBy(deductiveValidityAnalyzer),
        targets,
      });
    }

    return findings;
  },
};

/**
 * Describes a counterexample in terms of the claims, not the atom letters.
 *
 * Reads as "X holds, Y holds, and Z does not" — a statement about propositions,
 * which is what the tool is permitted to comment on.
 */
function renderAssignment<Id extends string>(
  ctx: AnalysisContext<Id>,
  atoms: Readonly<Record<string, Id>>,
  assignment: Assignment,
): string {
  const parts = Object.entries(assignment).map(([atom, value]) => {
    const claimId = atoms[atom];
    const label = claimId === undefined ? atom : q(claimText(ctx, claimId));
    return `${label} ${value ? 'holds' : 'does not hold'}`;
  });
  return list(parts);
}
