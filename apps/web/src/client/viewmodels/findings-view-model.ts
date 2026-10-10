import { makeAutoObservable } from 'mobx';
import type { Finding, FindingId, FindingKind, Severity } from '@make-your-case/domain';
import { targetRef, type ArgumentIndex } from '../model/argument-index.ts';
import type { Selection } from '../model/highlight.ts';
import type { SelectionSource } from './selection.ts';

/**
 * Observations, not verdicts (AGENTS.md section 1): these name what the
 * structure shows, never a fallacy or a judgment about the author.
 */
export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  implicit_premise: 'Unstated premise',
  load_bearing: 'Load-bearing claim',
  circularity: 'Circular support',
  unsupported_claim: 'Uncited fact',
  unconnected_claim: 'Unconnected claim',
  invalid_step: 'Conclusion does not follow',
  unchecked_step: 'Step not checked',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Information',
};

const SEVERITIES: readonly Severity[] = ['critical', 'warning', 'info'];

export interface FindingItem {
  readonly finding: Finding;
  readonly label: string;
  /** The canonical text of each claim the finding concerns, in target order. */
  readonly about: readonly string[];
}

export interface FindingGroup {
  readonly severity: Severity;
  readonly label: string;
  readonly items: readonly FindingItem[];
}

export interface FindingsScreen {
  readonly selection: Selection | null;
  select(selection: Selection | null, source: SelectionSource): void;
}

/**
 * The findings list (AGENTS.md section 9.2): grouped by severity, keyboard
 * navigable as one list, and clicking one focuses its elements everywhere.
 */
export class FindingsViewModel {
  /** The roving-tabindex position: which item the keyboard is on. */
  activeIndex = 0;

  readonly items: readonly FindingItem[];
  private readonly screen: FindingsScreen;

  constructor(index: ArgumentIndex, screen: FindingsScreen) {
    this.screen = screen;
    // `index.findings` is already most severe first, so groups and the flat
    // keyboard order agree.
    this.items = index.findings.map((finding) => ({
      finding,
      label: FINDING_KIND_LABELS[finding.kind],
      about: [...finding.targets]
        .sort((a, b) => a.ordinal - b.ordinal)
        .flatMap((target) => {
          const ref = targetRef(target);
          if (ref.kind !== 'claim') return [];
          const claim = index.claimById.get(ref.id);
          return claim === undefined ? [] : [claim.canonical_text];
        }),
    }));
    makeAutoObservable<this, 'screen'>(this, { items: false, screen: false }, { autoBind: true });
  }

  get groups(): readonly FindingGroup[] {
    return SEVERITIES.map((severity) => ({
      severity,
      label: SEVERITY_LABELS[severity],
      items: this.items.filter((item) => item.finding.severity === severity),
    })).filter((group) => group.items.length > 0);
  }

  get count(): number {
    return this.items.length;
  }

  get selectedId(): FindingId | null {
    const { selection } = this.screen;
    return selection?.type === 'finding' ? selection.id : null;
  }

  indexOf(id: FindingId): number {
    return this.items.findIndex((item) => item.finding.id === id);
  }

  moveNext(): void {
    this.activeIndex = Math.min(this.activeIndex + 1, this.items.length - 1);
  }

  movePrevious(): void {
    this.activeIndex = Math.max(this.activeIndex - 1, 0);
  }

  moveFirst(): void {
    this.activeIndex = 0;
  }

  moveLast(): void {
    this.activeIndex = Math.max(this.items.length - 1, 0);
  }

  /** Focuses the finding the keyboard is on. */
  focusActive(): void {
    const item = this.items[this.activeIndex];
    if (item !== undefined) this.focus(item.finding.id);
  }

  focus(id: FindingId): void {
    const position = this.indexOf(id);
    if (position === -1) return;
    this.activeIndex = position;
    this.screen.select({ type: 'finding', id }, 'findings');
  }

  /** Keeps the keyboard position on a finding selected elsewhere. */
  sync(id: FindingId): void {
    const position = this.indexOf(id);
    if (position !== -1) this.activeIndex = position;
  }
}
