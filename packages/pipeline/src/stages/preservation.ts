import type { ValidationIssue } from '@make-your-case/analysis';
import type { ArgumentGraphDraft, LocalId } from '@make-your-case/domain';
import type { ExtractResponse } from '../schemas/wire.ts';

/**
 * Holds reconstruct to what extraction found (AGENTS.md section 8.2:
 * reconstruct "must not alter or remove stated content's occurrences,
 * attribution, or citations"). Enforced in code rather than trusted to the
 * prompt; violations are validation errors and go back to the model.
 *
 * Matching is by span and attribution, not exact wording: canonicalization
 * and merging legitimately move an occurrence to another claim ID, and models
 * rarely reproduce surface text character for character. A citation may be
 * gained (a merged restatement inherits its twin's citation) but not lost or
 * changed.
 */
export function checkPreservation(
  extracted: ExtractResponse,
  draft: ArgumentGraphDraft,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const claims = new Map(draft.claims.map((claim) => [claim.id as string, claim]));
  const bySpan = new Map<string, { attribution: string; citation: string | null }[]>();
  for (const occurrence of draft.occurrences) {
    const claim = claims.get(occurrence.claim_id);
    if (claim === undefined) continue;
    const list = bySpan.get(occurrence.span_id) ?? [];
    list.push({ attribution: claim.attribution, citation: claim.citation });
    bySpan.set(occurrence.span_id, list);
  }

  for (const claim of extracted.claims) {
    for (const occurrence of claim.occurrences) {
      const candidates = (bySpan.get(occurrence.span_id) ?? []).filter(
        (candidate) => candidate.attribution === claim.attribution,
      );
      if (isPreserved(candidates, claim.citation)) continue;

      const refs = [claim.id, occurrence.span_id] as LocalId[];
      issues.push(
        candidates.length === 0
          ? {
              rule: 'preservation',
              message: `The extracted ${claim.attribution} claim "${claim.text}" (${claim.id}) occurs in span ${occurrence.span_id}, but no ${claim.attribution} claim in the reconstruction has an occurrence in that span. Keep every extracted occurrence, with its attribution.`,
              refs,
            }
          : {
              rule: 'preservation',
              message: `The extracted claim "${claim.text}" (${claim.id}) in span ${occurrence.span_id} cites "${String(claim.citation)}", but the reconstructed claim there does not. Keep extracted citations.`,
              refs,
            },
      );
    }
  }
  return issues;
}

function isPreserved(
  candidates: readonly { citation: string | null }[],
  citation: string | null,
): boolean {
  if (candidates.length === 0) return false;
  return (
    citation === null ||
    candidates.some((c) => c.citation !== null && sameCitation(c.citation, citation))
  );
}

function sameCitation(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalize(left).includes(normalize(right)) || normalize(right).includes(normalize(left));
}
