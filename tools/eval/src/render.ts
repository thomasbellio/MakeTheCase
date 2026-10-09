import type { AnalysisFinding, ArgumentGraphView, ClaimView } from '@make-your-case/domain';

/**
 * Renders a produced argument graph as text a judge model can read.
 *
 * Nothing else in the repository renders a graph; `renderSpans` in the pipeline
 * renders spans for a prompt, which is a different job. The output is for a
 * prompt, so it is compact and labelled rather than pretty: every attribute the
 * answer keys talk about (origin, attribution, citation, modality, kind) has to
 * be visible, or the judge cannot grade an expectation that mentions it.
 */

function claimLabel<Id extends string>(claim: ClaimView<Id>): string {
  const tags: string[] = [claim.kind];
  if (claim.modality !== 'asserted') tags.push(claim.modality);
  if (claim.origin !== 'stated') tags.push(claim.origin.toUpperCase());
  if (claim.attribution !== 'author') tags.push(claim.attribution);
  if (claim.is_thesis) tags.unshift('THESIS');

  const citation = claim.citation === null ? 'no citation' : `cited: ${claim.citation}`;
  return `[${claim.id}] (${tags.join(', ')}; ${citation}) ${claim.canonical_text}`;
}

export function renderGraph<Id extends string>(
  graph: ArgumentGraphView<Id>,
  findings: readonly AnalysisFinding<Id>[],
): string {
  const occurrenceCount = new Map<Id, number>();
  for (const occurrence of graph.occurrences) {
    occurrenceCount.set(occurrence.claim_id, (occurrenceCount.get(occurrence.claim_id) ?? 0) + 1);
  }

  const sections: string[] = [];

  const thesis = graph.claims.find((claim) => claim.is_thesis);
  sections.push(`THESIS: ${thesis === undefined ? '(none)' : thesis.canonical_text}`);

  sections.push(
    [
      'CLAIMS:',
      ...graph.claims.map((claim) => {
        const times = occurrenceCount.get(claim.id) ?? 0;
        const stated = times === 0 ? '' : ` — stated ${String(times)}×`;
        return `  ${claimLabel(claim)}${stated}`;
      }),
    ].join('\n'),
  );

  sections.push(
    [
      'INFERENCES (all premises are jointly required; alternative routes are separate inferences):',
      ...(graph.inferences.length === 0
        ? ['  (none)']
        : graph.inferences.map((inference) => {
            const premises = inference.premises.map((p) => p.claim_id).join(' + ');
            const tags: string[] = [inference.scheme];
            if (inference.attribution !== 'author') tags.push(inference.attribution);
            if (inference.formalization !== null) tags.push('formalized');
            return `  [${inference.id}] ${premises} -> ${inference.conclusion_claim_id} (${tags.join(', ')})`;
          })),
    ].join('\n'),
  );

  sections.push(
    [
      'RELATIONS:',
      ...(graph.relations.length === 0
        ? ['  (none)']
        : graph.relations.map((relation) => {
            const target = relation.target_claim_id ?? relation.target_inference_id ?? '?';
            return `  ${relation.source_claim_id} --${relation.type}--> ${target}`;
          })),
    ].join('\n'),
  );

  const order = { critical: 0, warning: 1, info: 2 } as const;
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  sections.push(
    [
      'FINDINGS:',
      ...(sorted.length === 0
        ? ['  (none)']
        : sorted.map((finding) => {
            const targets = finding.targets
              .map((t) => ('claim_id' in t ? t.claim_id : t.inference_id))
              .join(', ');
            return `  ${finding.kind} (${finding.severity}) [${targets}]: ${finding.explanation}`;
          })),
    ].join('\n'),
  );

  return sections.join('\n\n');
}
