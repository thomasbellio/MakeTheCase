import type {
  ArgumentGraph,
  Claim,
  ClaimId,
  Finding,
  Inference,
  InferenceId,
  Occurrence,
  Relation,
  Severity,
  Span,
  SpanId,
} from '@make-your-case/domain';

/**
 * Lookups and presentation facts over one revision, computed once.
 *
 * The client may import domain types only (AGENTS.md section 4), never
 * `analysis`, so what analysis concluded is read from the persisted
 * **findings** — `load_bearing`, `unsupported_claim` — rather than recomputed.
 * The UI then cannot disagree with the analysis it displays.
 *
 * **Order.** The repository returns rows in UUID order, which differs on every
 * read, and the map's layout follows input order. So everything here is
 * sorted into reading order: a stated claim by where it first appears in the
 * text, an inferred claim just after the claim it helps support. The map is
 * then stable across reloads and roughly follows the document.
 */
export interface ArgumentIndex {
  readonly revisionId: ArgumentGraph['revision_id'];
  /** By ordinal. */
  readonly spans: readonly Span[];
  /** Reading order. */
  readonly claims: readonly Claim[];
  readonly inferences: readonly Inference[];
  readonly relations: readonly Relation[];
  /** Most severe first, then by the position of their first target. */
  readonly findings: readonly Finding[];
  readonly thesis: Claim | null;

  readonly claimById: ReadonlyMap<ClaimId, Claim>;
  readonly inferenceById: ReadonlyMap<InferenceId, Inference>;
  readonly spanById: ReadonlyMap<SpanId, Span>;
  /** Each inference's premises, in reading order. */
  readonly premisesOf: ReadonlyMap<InferenceId, readonly ClaimId[]>;
  readonly inferencesConcluding: ReadonlyMap<ClaimId, readonly InferenceId[]>;
  /** Each claim's occurrences, by span ordinal. */
  readonly occurrencesOf: ReadonlyMap<ClaimId, readonly Occurrence[]>;
  readonly claimsInSpan: ReadonlyMap<SpanId, readonly ClaimId[]>;
  readonly findingsOfClaim: ReadonlyMap<ClaimId, readonly Finding[]>;
  readonly findingsOfInference: ReadonlyMap<InferenceId, readonly Finding[]>;

  /** Claims a `load_bearing` finding targets. */
  readonly loadBearing: ReadonlySet<ClaimId>;
  /** Claims an `unsupported_claim` finding targets: uncited, load-bearing facts. */
  readonly uncited: ReadonlySet<ClaimId>;
  /** Count of `critical` findings touching each claim or inference. */
  readonly criticalCount: ReadonlyMap<ClaimId | InferenceId, number>;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function indexArgument(graph: ArgumentGraph, spans: readonly Span[]): ArgumentIndex {
  const orderedSpans = [...spans].sort((a, b) => a.ordinal - b.ordinal);
  const spanById = new Map(orderedSpans.map((span) => [span.id, span]));
  const claimById = new Map(graph.claims.map((claim) => [claim.id, claim]));
  const inferenceById = new Map(graph.inferences.map((inference) => [inference.id, inference]));

  const occurrencesOf = groupBy(graph.occurrences, (o) => o.claim_id);
  for (const list of occurrencesOf.values()) {
    list.sort((a, b) => ordinalOf(spanById, a.span_id) - ordinalOf(spanById, b.span_id));
  }

  const premiseIds = groupBy(graph.premises, (p) => p.inference_id);
  const premiseOf = groupBy(graph.premises, (p) => p.claim_id);

  // Reading-order key per claim: [position in the text, inferred after stated, text].
  const position = new Map<ClaimId, number>();
  for (const claim of graph.claims) {
    const first = occurrencesOf.get(claim.id)?.[0];
    if (first !== undefined) position.set(claim.id, ordinalOf(spanById, first.span_id));
  }
  // An inferred claim has no occurrence; it sits beside the nearest stated
  // claim it supports. Walk premise → conclusion until one has a position.
  for (const claim of graph.claims) {
    if (position.has(claim.id)) continue;
    position.set(claim.id, inferredPosition(claim.id, position, premiseOf, inferenceById));
  }
  const claimKey = (claim: Claim): readonly (number | string)[] => [
    position.get(claim.id) ?? Number.MAX_SAFE_INTEGER,
    claim.origin === 'inferred' ? 1 : 0,
    claim.canonical_text,
  ];
  const claims = [...graph.claims].sort((a, b) => compareKeys(claimKey(a), claimKey(b)));
  const claimRank = new Map(claims.map((claim, i) => [claim.id, i]));
  const rankOf = (id: ClaimId): number => claimRank.get(id) ?? Number.MAX_SAFE_INTEGER;

  const premisesOf = new Map<InferenceId, ClaimId[]>();
  for (const inference of graph.inferences) {
    const ids = (premiseIds.get(inference.id) ?? []).map((p) => p.claim_id);
    premisesOf.set(
      inference.id,
      ids.sort((a, b) => rankOf(a) - rankOf(b)),
    );
  }

  const inferenceKey = (inference: Inference): readonly (number | string)[] => [
    rankOf(inference.conclusion_claim_id),
    ...(premisesOf.get(inference.id) ?? []).map(rankOf),
    inference.scheme,
  ];
  const inferences = [...graph.inferences].sort((a, b) =>
    compareKeys(inferenceKey(a), inferenceKey(b)),
  );
  const inferenceRank = new Map(inferences.map((inference, i) => [inference.id, i]));

  const inferencesConcluding = new Map<ClaimId, InferenceId[]>();
  for (const inference of inferences) {
    const list = inferencesConcluding.get(inference.conclusion_claim_id) ?? [];
    list.push(inference.id);
    inferencesConcluding.set(inference.conclusion_claim_id, list);
  }

  // Inferences rank after every claim, so a mixed list of targets still sorts.
  const inferenceRankOf = (id: InferenceId): number => claims.length + (inferenceRank.get(id) ?? 0);
  const targetRank = (relation: Relation): number => {
    if (relation.target_claim_id !== null) return rankOf(relation.target_claim_id);
    if (relation.target_inference_id !== null) return inferenceRankOf(relation.target_inference_id);
    return Number.MAX_SAFE_INTEGER;
  };
  const relations = [...graph.relations].sort((a, b) =>
    compareKeys(
      [rankOf(a.source_claim_id), targetRank(a), a.type],
      [rankOf(b.source_claim_id), targetRank(b), b.type],
    ),
  );

  const firstTargetRank = (finding: Finding): number => {
    const target = [...finding.targets].sort((a, b) => a.ordinal - b.ordinal)[0];
    if (target === undefined) return Number.MAX_SAFE_INTEGER;
    const ref = targetRef(target);
    return ref.kind === 'claim' ? rankOf(ref.id) : inferenceRankOf(ref.id);
  };
  const findings = [...graph.findings].sort((a, b) =>
    compareKeys(
      [SEVERITY_RANK[a.severity], firstTargetRank(a), a.kind, a.explanation],
      [SEVERITY_RANK[b.severity], firstTargetRank(b), b.kind, b.explanation],
    ),
  );

  const findingsOfClaim = new Map<ClaimId, Finding[]>();
  const findingsOfInference = new Map<InferenceId, Finding[]>();
  const criticalCount = new Map<ClaimId | InferenceId, number>();
  const loadBearing = new Set<ClaimId>();
  const uncited = new Set<ClaimId>();
  for (const finding of findings) {
    for (const target of finding.targets) {
      const ref = targetRef(target);
      if (ref.kind === 'claim') {
        push(findingsOfClaim, ref.id, finding);
        if (finding.kind === 'load_bearing') loadBearing.add(ref.id);
        if (finding.kind === 'unsupported_claim') uncited.add(ref.id);
      } else {
        push(findingsOfInference, ref.id, finding);
      }
      if (finding.severity === 'critical') {
        criticalCount.set(ref.id, (criticalCount.get(ref.id) ?? 0) + 1);
      }
    }
  }

  const claimsInSpan = new Map<SpanId, ClaimId[]>();
  for (const claim of claims) {
    for (const occurrence of occurrencesOf.get(claim.id) ?? []) {
      push(claimsInSpan, occurrence.span_id, claim.id);
    }
  }

  return {
    revisionId: graph.revision_id,
    spans: orderedSpans,
    claims,
    inferences,
    relations,
    findings,
    thesis: claims.find((claim) => claim.is_thesis) ?? null,
    claimById,
    inferenceById,
    spanById,
    premisesOf,
    inferencesConcluding,
    occurrencesOf,
    claimsInSpan,
    findingsOfClaim,
    findingsOfInference,
    loadBearing,
    uncited,
    criticalCount,
  };
}

export type TargetRef =
  | { readonly kind: 'claim'; readonly id: ClaimId }
  | { readonly kind: 'inference'; readonly id: InferenceId };

/**
 * A finding target with its id narrowed by its discriminant. `Finding` types
 * every target id as `ClaimId | InferenceId` (it is generic over one id
 * parameter), so the narrowing the `target` field guarantees is restated here,
 * once.
 */
export function targetRef(target: Finding['targets'][number]): TargetRef {
  return target.target === 'claim'
    ? { kind: 'claim', id: target.claim_id as ClaimId }
    : { kind: 'inference', id: target.inference_id as InferenceId };
}

function inferredPosition(
  start: ClaimId,
  position: ReadonlyMap<ClaimId, number>,
  premiseOf: ReadonlyMap<ClaimId, readonly { readonly inference_id: InferenceId }[]>,
  inferenceById: ReadonlyMap<InferenceId, Inference>,
): number {
  const seen = new Set<ClaimId>([start]);
  let frontier: ClaimId[] = [start];
  while (frontier.length > 0) {
    const next: ClaimId[] = [];
    let best = Number.MAX_SAFE_INTEGER;
    for (const id of frontier) {
      for (const { inference_id } of premiseOf.get(id) ?? []) {
        const conclusion = inferenceById.get(inference_id)?.conclusion_claim_id;
        if (conclusion === undefined || seen.has(conclusion)) continue;
        seen.add(conclusion);
        const found = position.get(conclusion);
        if (found !== undefined) best = Math.min(best, found);
        next.push(conclusion);
      }
    }
    if (best !== Number.MAX_SAFE_INTEGER) return best;
    frontier = next;
  }
  return Number.MAX_SAFE_INTEGER;
}

function ordinalOf(spanById: ReadonlyMap<SpanId, Span>, id: SpanId): number {
  return spanById.get(id)?.ordinal ?? Number.MAX_SAFE_INTEGER;
}

function compareKeys(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) push(groups, key(item), item);
  return groups;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
}
