import type { ArgumentGraphDraft, Formalization, Formula, LocalId } from '@make-your-case/domain';
import type { ValidationIssue } from '@make-your-case/analysis';
import { buildFormula } from './wire-formula.ts';
import type { ReconstructResponse, WireFormalization } from './wire.ts';

export interface DraftConversion {
  readonly draft: ArgumentGraphDraft;
  /** Problems the draft's shape cannot express, such as an unbuildable formula. Treated as validation errors. */
  readonly issues: readonly ValidationIssue[];
}

/**
 * Flattens a reconstruct response into the domain's draft shape.
 *
 * IDs are carried across unchecked: `validateArgumentGraph` parses the draft
 * through `argumentGraphDraftSchema` first, so a malformed local ID becomes a
 * validation error that goes back to the model, rather than an exception here.
 * A premise's `origin` is copied from the claim it points at, because the
 * validator requires the two to agree and the model has no reason to restate it.
 */
export function reconstructResponseToDraft(response: ReconstructResponse): DraftConversion {
  const issues: ValidationIssue[] = [];
  const claimOrigin = new Map(response.claims.map((claim) => [claim.id, claim.origin]));

  const draft: ArgumentGraphDraft = {
    claims: response.claims.map((claim) => ({
      id: asLocalId(claim.id),
      canonical_text: claim.text,
      kind: claim.kind,
      modality: claim.modality,
      origin: claim.origin,
      attribution: claim.attribution,
      citation: claim.citation === '' ? null : claim.citation,
      confidence: claim.confidence,
      is_thesis: claim.is_thesis,
    })),
    occurrences: response.claims.flatMap((claim) =>
      claim.occurrences.map((occurrence) => ({
        claim_id: asLocalId(claim.id),
        span_id: asLocalId(occurrence.span_id),
        surface_text: occurrence.surface_text,
      })),
    ),
    inferences: response.inferences.map((inference) => {
      let formalization: Formalization<LocalId> | null = null;
      if (inference.formalization !== null) {
        const built = buildFormalization(inference.formalization);
        if (built.ok) {
          formalization = built.value;
        } else {
          issues.push({
            rule: 'formalization-encoding',
            message: `Inference ${inference.id}: ${built.message}.`,
            refs: [asLocalId(inference.id)],
          });
        }
      }
      return {
        id: asLocalId(inference.id),
        conclusion_claim_id: asLocalId(inference.conclusion_id),
        formalization,
        scheme: inference.scheme,
        origin: inference.origin,
        attribution: inference.attribution,
        confidence: inference.confidence,
      };
    }),
    premises: response.inferences.flatMap((inference) =>
      inference.premise_ids.map((claimId) => ({
        inference_id: asLocalId(inference.id),
        claim_id: asLocalId(claimId),
        // An unknown claim is reported by the reference rule; any origin will do meanwhile.
        origin: claimOrigin.get(claimId) ?? 'stated',
      })),
    ),
    relations: response.relations.map((relation) => ({
      id: asLocalId(relation.id),
      type: relation.type,
      source_claim_id: asLocalId(relation.source_claim_id),
      target_claim_id:
        relation.target_claim_id === null ? null : asLocalId(relation.target_claim_id),
      target_inference_id:
        relation.target_inference_id === null ? null : asLocalId(relation.target_inference_id),
    })),
    findings: [],
  };

  return { draft, issues };
}

type Built<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

function buildFormalization(wire: WireFormalization): Built<Formalization<LocalId>> {
  const atoms: Record<string, LocalId> = {};
  for (const atom of wire.atoms) {
    if (atom.name in atoms) return { ok: false, message: `atom "${atom.name}" is declared twice` };
    atoms[atom.name] = asLocalId(atom.claim_id);
  }

  const premises: Formula[] = [];
  for (const root of wire.premise_roots) {
    const built = buildFormula(wire.nodes, root);
    if (!built.ok) return { ok: false, message: built.message };
    premises.push(built.formula);
  }
  const conclusion = buildFormula(wire.nodes, wire.conclusion_root);
  if (!conclusion.ok) return { ok: false, message: conclusion.message };

  return { ok: true, value: { atoms, premises, conclusion: conclusion.formula } };
}

// Unchecked by design; see the doc comment on `reconstructResponseToDraft`.
function asLocalId(value: string): LocalId {
  return value as LocalId;
}
