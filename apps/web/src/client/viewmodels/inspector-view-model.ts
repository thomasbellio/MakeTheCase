import { makeAutoObservable } from 'mobx';
import type {
  Claim,
  ClaimId,
  Finding,
  Inference,
  InferenceId,
  Relation,
  Span,
} from '@make-your-case/domain';
import { targetRef, type ArgumentIndex } from '../model/argument-index.ts';
import type { Selection } from '../model/highlight.ts';
import type { SelectionSource } from './selection.ts';

export interface OccurrenceView {
  readonly span: Span;
  /** The author's own words. */
  readonly surfaceText: string;
}

export interface RelationView {
  readonly relation: Relation;
  /** The claim on the other end: the attacker for incoming, the target for outgoing. */
  readonly other: Claim | null;
  readonly otherInference: Inference | null;
}

export type InspectorDetails =
  | {
      readonly type: 'claim';
      readonly claim: Claim;
      readonly occurrences: readonly OccurrenceView[];
      readonly loadBearing: boolean;
      readonly uncited: boolean;
      /** Inferences concluding this claim. */
      readonly supportedBy: readonly Inference[];
      /** Inferences this claim is a premise of. */
      readonly supports: readonly Inference[];
      readonly incoming: readonly RelationView[];
      readonly outgoing: readonly RelationView[];
      readonly findings: readonly Finding[];
    }
  | {
      readonly type: 'inference';
      readonly inference: Inference;
      readonly premises: readonly Claim[];
      readonly conclusion: Claim | null;
      readonly incoming: readonly RelationView[];
      readonly findings: readonly Finding[];
    }
  | {
      readonly type: 'span';
      readonly span: Span;
      readonly text: string;
      readonly claims: readonly Claim[];
    }
  | {
      readonly type: 'finding';
      readonly finding: Finding;
      readonly claims: readonly Claim[];
      readonly inferences: readonly Inference[];
    };

export interface InspectorScreen {
  readonly selection: Selection | null;
  select(selection: Selection | null, source: SelectionSource): void;
}

/** The selected element's details (AGENTS.md section 9.2), plus links to its neighbours. */
export class InspectorViewModel {
  private readonly index: ArgumentIndex;
  private readonly sourceText: string;
  private readonly screen: InspectorScreen;

  constructor(index: ArgumentIndex, sourceText: string, screen: InspectorScreen) {
    this.index = index;
    this.sourceText = sourceText;
    this.screen = screen;
    makeAutoObservable<this, 'index' | 'sourceText' | 'screen'>(
      this,
      { index: false, sourceText: false, screen: false },
      { autoBind: true },
    );
  }

  get details(): InspectorDetails | null {
    const { selection } = this.screen;
    if (selection === null) return null;
    const index = this.index;

    switch (selection.type) {
      case 'claim': {
        const claim = index.claimById.get(selection.id);
        if (claim === undefined) return null;
        return {
          type: 'claim',
          claim,
          occurrences: (index.occurrencesOf.get(claim.id) ?? []).flatMap((occurrence) => {
            const span = index.spanById.get(occurrence.span_id);
            return span === undefined ? [] : [{ span, surfaceText: occurrence.surface_text }];
          }),
          loadBearing: index.loadBearing.has(claim.id),
          uncited: index.uncited.has(claim.id),
          supportedBy: this.inferences(index.inferencesConcluding.get(claim.id) ?? []),
          supports: index.inferences.filter((inference) =>
            (index.premisesOf.get(inference.id) ?? []).includes(claim.id),
          ),
          incoming: index.relations
            .filter((relation) => relation.target_claim_id === claim.id)
            .map((relation) => this.relationView(relation, relation.source_claim_id)),
          outgoing: index.relations
            .filter((relation) => relation.source_claim_id === claim.id)
            .map((relation) =>
              this.relationView(relation, relation.target_claim_id, relation.target_inference_id),
            ),
          findings: index.findingsOfClaim.get(claim.id) ?? [],
        };
      }
      case 'inference': {
        const inference = index.inferenceById.get(selection.id);
        if (inference === undefined) return null;
        return {
          type: 'inference',
          inference,
          premises: this.claims(index.premisesOf.get(inference.id) ?? []),
          conclusion: index.claimById.get(inference.conclusion_claim_id) ?? null,
          incoming: index.relations
            .filter((relation) => relation.target_inference_id === inference.id)
            .map((relation) => this.relationView(relation, relation.source_claim_id)),
          findings: index.findingsOfInference.get(inference.id) ?? [],
        };
      }
      case 'span': {
        const span = index.spanById.get(selection.id);
        if (span === undefined) return null;
        return {
          type: 'span',
          span,
          text: this.sourceText.slice(span.char_start, span.char_end),
          claims: this.claims(index.claimsInSpan.get(span.id) ?? []),
        };
      }
      case 'finding': {
        const finding = index.findings.find((f) => f.id === selection.id);
        if (finding === undefined) return null;
        const refs = [...finding.targets].sort((a, b) => a.ordinal - b.ordinal).map(targetRef);
        return {
          type: 'finding',
          finding,
          claims: this.claims(refs.flatMap((ref) => (ref.kind === 'claim' ? [ref.id] : []))),
          inferences: this.inferences(
            refs.flatMap((ref) => (ref.kind === 'inference' ? [ref.id] : [])),
          ),
        };
      }
    }
  }

  selectClaim(id: ClaimId): void {
    this.screen.select({ type: 'claim', id }, 'inspector');
  }

  selectInference(id: InferenceId): void {
    this.screen.select({ type: 'inference', id }, 'inspector');
  }

  private claims(ids: readonly ClaimId[]): Claim[] {
    return ids.flatMap((id) => {
      const claim = this.index.claimById.get(id);
      return claim === undefined ? [] : [claim];
    });
  }

  private inferences(ids: readonly InferenceId[]): Inference[] {
    return ids.flatMap((id) => {
      const inference = this.index.inferenceById.get(id);
      return inference === undefined ? [] : [inference];
    });
  }

  private relationView(
    relation: Relation,
    otherClaim: ClaimId | null,
    otherInference: InferenceId | null = null,
  ): RelationView {
    return {
      relation,
      other: otherClaim === null ? null : (this.index.claimById.get(otherClaim) ?? null),
      otherInference:
        otherInference === null ? null : (this.index.inferenceById.get(otherInference) ?? null),
    };
  }
}
