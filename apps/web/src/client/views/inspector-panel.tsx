'use client';

import type { ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { Claim, Finding, Inference } from '@make-your-case/domain';
import { RELATION_LABELS } from '../model/map-graph';
import { FINDING_KIND_LABELS, SEVERITY_LABELS } from '../viewmodels/findings-view-model';
import type { InspectorViewModel, RelationView } from '../viewmodels/inspector-view-model';
import {
  ATTRIBUTION_LABELS,
  CLAIM_KIND_LABELS,
  MODALITY_LABELS,
  ORIGIN_LABELS,
  SCHEME_LABELS,
} from './labels';

/** The selected element's details (AGENTS.md section 9.2). */
export const InspectorPanel = observer(function InspectorPanel({
  inspector,
}: {
  inspector: InspectorViewModel;
}) {
  const details = inspector.details;
  if (details === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a claim, an inference, a sentence or a finding to see its details.
      </p>
    );
  }

  const claimLink = (claim: Claim) => (
    <LinkButton
      key={claim.id}
      onClick={() => {
        inspector.selectClaim(claim.id);
      }}
    >
      {claim.origin === 'inferred' ? `[Inferred] ${claim.canonical_text}` : claim.canonical_text}
    </LinkButton>
  );
  const inferenceLink = (inference: Inference, label?: string) => (
    <LinkButton
      key={inference.id}
      onClick={() => {
        inspector.selectInference(inference.id);
      }}
    >
      {label ?? `${SCHEME_LABELS[inference.scheme]} inference`}
    </LinkButton>
  );

  switch (details.type) {
    case 'claim': {
      const { claim } = details;
      return (
        <article aria-label="Selected claim" className="flex flex-col gap-3 text-sm">
          <p className="text-base leading-snug">{claim.canonical_text}</p>
          {claim.origin === 'inferred' && (
            <p className="rounded-md border border-dashed p-2 text-muted-foreground">
              The system inferred this premise; the author did not state it.
            </p>
          )}
          <Fields>
            <Field label="Role">{claim.is_thesis ? 'Thesis' : 'Claim'}</Field>
            <Field label="Kind">{CLAIM_KIND_LABELS[claim.kind]}</Field>
            <Field label="Modality">{MODALITY_LABELS[claim.modality]}</Field>
            <Field label="Origin">{ORIGIN_LABELS[claim.origin]}</Field>
            <Field label="Asserted by">{ATTRIBUTION_LABELS[claim.attribution]}</Field>
            <Field label="Citation">
              {claim.citation ??
                (details.uncited ? 'None — a load-bearing fact without one' : 'None')}
            </Field>
            <Field label="Load-bearing">{details.loadBearing ? 'Yes' : 'No'}</Field>
            <Field label="Confidence">{percent(claim.confidence)}</Field>
          </Fields>
          {details.occurrences.length > 0 && (
            <Section title="In the text">
              {details.occurrences.map((occurrence) => (
                <blockquote
                  key={occurrence.span.id}
                  className="border-l-2 pl-2 text-muted-foreground"
                >
                  {occurrence.surfaceText}
                </blockquote>
              ))}
            </Section>
          )}
          <Links title="Supported by" items={details.supportedBy.map((i) => inferenceLink(i))} />
          <Links title="Premise of" items={details.supports.map((i) => inferenceLink(i))} />
          <Relations title="Challenged by" relations={details.incoming} claimLink={claimLink} />
          <Relations
            title="Challenges"
            relations={details.outgoing}
            claimLink={claimLink}
            inferenceLink={(inference) => inferenceLink(inference)}
          />
          <FindingList findings={details.findings} />
        </article>
      );
    }
    case 'inference': {
      const { inference } = details;
      return (
        <article aria-label="Selected inference" className="flex flex-col gap-3 text-sm">
          <p className="text-base">{SCHEME_LABELS[inference.scheme]} inference</p>
          <Fields>
            <Field label="Origin">{ORIGIN_LABELS[inference.origin]}</Field>
            <Field label="Asserted by">{ATTRIBUTION_LABELS[inference.attribution]}</Field>
            <Field label="Confidence">{percent(inference.confidence)}</Field>
            {inference.scheme === 'deductive' && (
              <Field label="Validity">
                {inference.formalization === null ? 'Not checked' : 'Checked'}
              </Field>
            )}
          </Fields>
          <Links title="Premises (all required together)" items={details.premises.map(claimLink)} />
          <Links
            title="Conclusion"
            items={details.conclusion === null ? [] : [claimLink(details.conclusion)]}
          />
          <Relations title="Challenged by" relations={details.incoming} claimLink={claimLink} />
          <FindingList findings={details.findings} />
        </article>
      );
    }
    case 'span':
      return (
        <article aria-label="Selected sentence" className="flex flex-col gap-3 text-sm">
          <blockquote className="border-l-2 pl-2">{details.text}</blockquote>
          <Fields>
            <Field label="Function">{details.span.function}</Field>
          </Fields>
          <Links title="Claims stated here" items={details.claims.map(claimLink)} />
        </article>
      );
    case 'finding': {
      const { finding } = details;
      return (
        <article aria-label="Selected finding" className="flex flex-col gap-3 text-sm">
          <p className="text-base">{FINDING_KIND_LABELS[finding.kind]}</p>
          <p>{finding.explanation}</p>
          <Fields>
            <Field label="Severity">{SEVERITY_LABELS[finding.severity]}</Field>
            <Field label="Produced by">{finding.produced_by}</Field>
          </Fields>
          <Links
            title="Concerns"
            items={[
              ...details.claims.map(claimLink),
              ...details.inferences.map((i) => inferenceLink(i)),
            ]}
          />
        </article>
      );
    }
  }
});

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

function Fields({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{children}</dl>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Links({ title, items }: { title: string; items: ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </Section>
  );
}

function Relations({
  title,
  relations,
  claimLink,
  inferenceLink,
}: {
  title: string;
  relations: readonly RelationView[];
  claimLink: (claim: Claim) => ReactNode;
  inferenceLink?: (inference: Inference) => ReactNode;
}) {
  return (
    <Links
      title={title}
      items={relations.map((view) => (
        <span key={view.relation.id} className="flex flex-col">
          <span className="text-xs text-opposing">{RELATION_LABELS[view.relation.type]}</span>
          {view.other !== null && claimLink(view.other)}
          {view.otherInference !== null && inferenceLink?.(view.otherInference)}
        </span>
      ))}
    />
  );
}

function FindingList({ findings }: { findings: readonly Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <Section title="Findings">
      <ul className="flex flex-col gap-1">
        {findings.map((finding) => (
          <li key={finding.id}>
            <span className="font-medium">{FINDING_KIND_LABELS[finding.kind]}</span>
            <span className="text-muted-foreground"> — {finding.explanation}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  );
}
