import {
  localId,
  type ArgumentGraphDraft,
  type Attribution,
  type ClaimKind,
  type Formalization,
  type InferenceScheme,
  type LocalId,
  type Modality,
  type Origin,
  type RelationType,
} from '@make-your-case/domain';

/**
 * A terse constructor for hand-built argument graphs, used by the Phase 1
 * acceptance fixtures (AGENTS.md section 7.5).
 *
 * Written as a builder because the alternative — plain object literals — runs
 * to hundreds of lines of eight-field records for a twenty-claim graph, and a
 * fixture nobody can read is a fixture nobody can check against the answer key.
 *
 * Two deliberate properties:
 *
 * - `build()` performs **no validation and no repair**. The validation fixtures
 *   depend on being able to emit genuinely broken graphs.
 * - It infers nothing the real pipeline would not produce. The only convenience
 *   is attaching one occurrence per stated claim, which the pipeline always
 *   does and which section 7.3 requires.
 */

export interface ClaimOverrides {
  readonly kind?: ClaimKind;
  readonly modality?: Modality;
  readonly citation?: string | null;
  readonly confidence?: number;
  readonly attribution?: Attribution;
  readonly origin?: Origin;
  /** Suppresses the automatic occurrence, for the "stated claim with no occurrence" case. */
  readonly withoutOccurrence?: boolean;
}

export interface InferenceOverrides {
  readonly scheme?: InferenceScheme;
  readonly origin?: Origin;
  readonly attribution?: Attribution;
  readonly confidence?: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

export class GraphBuilder {
  private readonly claims: Mutable<ArgumentGraphDraft>['claims'] = [];
  private readonly occurrences: Mutable<ArgumentGraphDraft>['occurrences'] = [];
  private readonly inferences: Mutable<ArgumentGraphDraft>['inferences'] = [];
  private readonly premises: Mutable<ArgumentGraphDraft>['premises'] = [];
  private readonly relations: Mutable<ArgumentGraphDraft>['relations'] = [];
  private spanCounter = 0;

  /** Every span the builder invented, to pass to `validateArgumentGraph`. */
  readonly spanIds: LocalId[] = [];

  private addClaim(
    id: string,
    text: string,
    attribution: Attribution,
    overrides: ClaimOverrides,
    isThesis: boolean,
  ): this {
    const origin = overrides.origin ?? 'stated';
    this.claims.push({
      id: localId(id),
      canonical_text: text,
      kind: overrides.kind ?? 'factual',
      modality: overrides.modality ?? 'asserted',
      origin,
      attribution: overrides.attribution ?? attribution,
      citation: overrides.citation ?? null,
      confidence: overrides.confidence ?? 1,
      is_thesis: isThesis,
    });

    // Inferred claims have no occurrences by definition: the author never
    // stated them.
    if (origin === 'stated' && overrides.withoutOccurrence !== true) {
      this.occurrence(id, this.nextSpan(), text);
    }
    return this;
  }

  private nextSpan(): string {
    this.spanCounter += 1;
    const id = `s${String(this.spanCounter)}`;
    this.spanIds.push(localId(id));
    return id;
  }

  claim(id: string, text: string, overrides: ClaimOverrides = {}): this {
    return this.addClaim(id, text, 'author', overrides, false);
  }

  thesis(id: string, text: string, overrides: ClaimOverrides = {}): this {
    return this.addClaim(id, text, 'author', overrides, true);
  }

  /** An author claim the system supplied rather than found in the text. */
  inferred(id: string, text: string, overrides: ClaimOverrides = {}): this {
    return this.addClaim(id, text, 'author', { ...overrides, origin: 'inferred' }, false);
  }

  opposing(id: string, text: string, overrides: ClaimOverrides = {}): this {
    return this.addClaim(id, text, 'opposing', overrides, false);
  }

  thirdParty(id: string, text: string, overrides: ClaimOverrides = {}): this {
    return this.addClaim(id, text, 'third_party', overrides, false);
  }

  occurrence(claimId: string, spanId: string, surfaceText: string): this {
    this.occurrences.push({
      claim_id: localId(claimId),
      span_id: localId(spanId),
      surface_text: surfaceText,
    });
    return this;
  }

  /** Adds `count` further occurrences of a claim, for restatement cases. */
  restated(claimId: string, count: number): this {
    const claim = this.claims.find((c) => c.id === localId(claimId));
    for (let i = 0; i < count; i += 1) {
      this.occurrence(claimId, this.nextSpan(), claim?.canonical_text ?? claimId);
    }
    return this;
  }

  infer(
    id: string,
    premiseIds: readonly string[],
    conclusionId: string,
    overrides: InferenceOverrides = {},
  ): this {
    const attribution =
      overrides.attribution ??
      this.claims.find((c) => c.id === localId(conclusionId))?.attribution ??
      'author';

    this.inferences.push({
      id: localId(id),
      conclusion_claim_id: localId(conclusionId),
      scheme: overrides.scheme ?? 'deductive',
      origin: overrides.origin ?? 'stated',
      attribution,
      formalization: null,
      confidence: overrides.confidence ?? 1,
    });

    for (const premiseId of premiseIds) {
      // The premise row's origin describes the claim it points at, which
      // validation checks, so take it from there rather than defaulting.
      const origin = this.claims.find((c) => c.id === localId(premiseId))?.origin ?? 'stated';
      this.premises.push({
        inference_id: localId(id),
        claim_id: localId(premiseId),
        origin,
      });
    }
    return this;
  }

  formalize(inferenceId: string, formalization: Formalization<string>): this {
    const index = this.inferences.findIndex((i) => i.id === localId(inferenceId));
    const inference = this.inferences[index];
    if (inference === undefined) return this;

    this.inferences[index] = {
      ...inference,
      formalization: {
        atoms: Object.fromEntries(
          Object.entries(formalization.atoms).map(([atom, claimId]) => [atom, localId(claimId)]),
        ),
        premises: [...formalization.premises],
        conclusion: formalization.conclusion,
      },
    };
    return this;
  }

  relate(
    id: string,
    type: RelationType,
    sourceClaimId: string,
    target: { readonly claim: string } | { readonly inference: string },
  ): this {
    this.relations.push({
      id: localId(id),
      type,
      source_claim_id: localId(sourceClaimId),
      target_claim_id: 'claim' in target ? localId(target.claim) : null,
      target_inference_id: 'inference' in target ? localId(target.inference) : null,
    });
    return this;
  }

  /** Escape hatch for deliberately malformed graphs. */
  patch(fn: (draft: Mutable<ArgumentGraphDraft>) => void): this {
    fn({
      claims: this.claims,
      occurrences: this.occurrences,
      inferences: this.inferences,
      premises: this.premises,
      relations: this.relations,
      findings: [],
    });
    return this;
  }

  build(): ArgumentGraphDraft {
    return {
      claims: this.claims,
      occurrences: this.occurrences,
      inferences: this.inferences,
      premises: this.premises,
      relations: this.relations,
      findings: [],
    };
  }
}

export function graph(): GraphBuilder {
  return new GraphBuilder();
}
