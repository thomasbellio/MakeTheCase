// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { observable } from 'mobx';
import { newId, type RunEvent, type RunId, type SpanId } from '@make-your-case/domain';
import { indexArgument } from '../model/argument-index';
import { highlightFor, NO_HIGHLIGHT, type Selection } from '../model/highlight';
import { claimTagCount, type ClaimNodeData } from '../model/map-graph';
import { applyEvent, emptyTimeline } from '../model/stage-timeline';
import { sampleArgument } from '../testing/sample-argument';
import { FindingsViewModel } from '../viewmodels/findings-view-model';
import { FindingsPanel } from './findings-panel';
import { ClaimNodeView } from './map-nodes';
import { RunTimeline, type TimelineSource } from './run-timeline';
import { SourceTextView, type SourceTextScreen } from './source-text-view';

afterEach(() => {
  cleanup();
});

/** A stub's fields are set by the test, unlike the ViewModel's. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const claimData = (overrides: Partial<ClaimNodeData> = {}): ClaimNodeData => ({
  kind: 'claim',
  claimId: newId(),
  text: 'An email satisfies the written-notice requirement.',
  claimKind: 'definitional',
  modality: 'asserted',
  origin: 'stated',
  attribution: 'author',
  isThesis: false,
  loadBearing: false,
  uncited: false,
  criticalCount: 0,
  highlighted: false,
  selected: false,
  ...overrides,
});

describe('ClaimNodeView', () => {
  it('shows a plain stated claim with only its kind', () => {
    render(<ClaimNodeView data={claimData()} />);
    const node = screen.getByTestId('claim-node');

    expect(within(node).getByText('Definition')).toBeTruthy();
    expect(within(node).queryByText('Inferred')).toBeNull();
    expect(within(node).queryByText('Thesis')).toBeNull();
  });

  it('marks an inferred claim with a dashed border and a label, not colour alone', () => {
    render(<ClaimNodeView data={claimData({ origin: 'inferred' })} />);
    const node = screen.getByTestId('claim-node');

    expect(within(node).getByText('Inferred')).toBeTruthy();
    expect(node.className).toContain('border-dashed');
  });

  it('labels the thesis, load-bearing, uncited and critical states', () => {
    render(
      <ClaimNodeView
        data={claimData({ isThesis: true, loadBearing: true, uncited: true, criticalCount: 2 })}
      />,
    );
    const node = screen.getByTestId('claim-node');

    for (const label of ['Thesis', 'Load-bearing', 'Uncited', '2 critical']) {
      expect(within(node).getByText(label)).toBeTruthy();
    }
  });

  it("labels the opposing party's claims", () => {
    render(<ClaimNodeView data={claimData({ attribution: 'opposing' })} />);
    expect(within(screen.getByTestId('claim-node')).getByText('Opposing party')).toBeTruthy();
  });

  it('renders as many tags as the layout allowed height for', () => {
    for (const data of [
      claimData(),
      claimData({ origin: 'inferred', loadBearing: true, criticalCount: 1 }),
      claimData({ isThesis: true, attribution: 'opposing', modality: 'hedged', uncited: true }),
    ]) {
      const { container, unmount } = render(<ClaimNodeView data={data} />);
      const tagRow = container.querySelector('[data-testid="claim-node"] > div');
      expect(tagRow?.children).toHaveLength(claimTagCount(data));
      unmount();
    }
  });

  it('shows hedged modality', () => {
    render(<ClaimNodeView data={claimData({ modality: 'probable' })} />);
    expect(screen.getByText('Probable')).toBeTruthy();
  });
});

describe('FindingsPanel', () => {
  function setup() {
    const sample = sampleArgument();
    const index = indexArgument(sample.graph, sample.spans);
    // Spies stay plain functions: `observable` would wrap them as actions.
    const stub = observable(
      {
        selection: null as Selection | null,
        select: vi.fn((selection: Selection | null) => {
          stub.selection = selection;
        }),
      },
      { select: false },
    );
    const findings = new FindingsViewModel(index, stub);
    return { findings, stub };
  }

  it('groups findings under severity headings', () => {
    const { findings } = setup();
    render(<FindingsPanel findings={findings} />);

    expect(screen.getByRole('heading', { name: /Critical \(1\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Warning \(1\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Information \(5\)/ })).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(7);
  });

  it('moves with the arrow keys and focuses the finding on Enter', async () => {
    const user = userEvent.setup();
    const { findings, stub } = setup();
    render(<FindingsPanel findings={findings} />);

    const list = screen.getByRole('listbox', { name: 'Findings' });
    list.focus();
    expect(list.getAttribute('aria-activedescendant')).toBe('finding-option-0');

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(list.getAttribute('aria-activedescendant')).toBe('finding-option-1');

    await user.keyboard('{Enter}');
    const second = findings.items[1]?.finding.id;
    expect(stub.select).toHaveBeenCalledWith({ type: 'finding', id: second }, 'findings');
    expect(screen.getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('focuses a finding on click', async () => {
    const user = userEvent.setup();
    const { findings, stub } = setup();
    render(<FindingsPanel findings={findings} />);

    await user.click(screen.getByText('Uncited fact'));

    expect(stub.select).toHaveBeenCalledWith(
      { type: 'finding', id: findings.items[1]?.finding.id },
      'findings',
    );
  });
});

describe('RunTimeline', () => {
  const runId = newId<RunId>();
  const event = (sequence: number, fields: Partial<RunEvent>): RunEvent => ({
    id: newId(),
    run_id: runId,
    sequence,
    stage: null,
    type: 'stage_started',
    payload: null,
    created_at: new Date(),
    ...fields,
  });

  function source(events: RunEvent[], fields: Partial<TimelineSource> = {}): TimelineSource {
    return {
      timeline: events.reduce(applyEvent, emptyTimeline()),
      connection: 'open',
      isQueued: false,
      ...fields,
    };
  }

  it('says when the run is still waiting to start', () => {
    render(<RunTimeline progress={source([], { isQueued: true })} />);
    expect(screen.getByText('Waiting for the analysis to start…')).toBeTruthy();
  });

  it("shows each stage's state, in text as well as by icon", () => {
    render(
      <RunTimeline
        progress={source([
          event(0, { type: 'stage_started', stage: 'segment' }),
          event(1, { type: 'stage_completed', stage: 'segment', payload: { spans: 9 } }),
          event(2, { type: 'stage_started', stage: 'classify' }),
          event(3, {
            type: 'stage_progress',
            stage: 'classify',
            payload: { message: 'Classified 3 of 9 spans' },
          }),
        ])}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('Done');
    expect(items[0]?.textContent).toContain('9 sentences');
    expect(items[1]?.textContent).toContain('In progress');
    expect(items[1]?.textContent).toContain('Classified 3 of 9 spans');
    expect(items[2]?.textContent).toContain('Not started');
  });

  it('shows retry notices', () => {
    render(
      <RunTimeline
        progress={source([
          event(0, {
            type: 'validation_retry',
            stage: 'validate',
            payload: { attempt: 1, errorCount: 2 },
          }),
        ])}
      />,
    );
    expect(screen.getByText(/2 structural problems on attempt 1; trying again/)).toBeTruthy();
  });

  it('marks the failed stage', () => {
    render(
      <RunTimeline
        progress={source([
          event(0, { type: 'stage_started', stage: 'extract' }),
          event(1, { type: 'run_failed', payload: { message: 'Stopped.' } }),
        ])}
      />,
    );
    expect(screen.getAllByRole('listitem')[2]?.getAttribute('data-state')).toBe('failed');
  });

  it('says when the connection is being re-established', () => {
    render(<RunTimeline progress={source([], { connection: 'reconnecting' })} />);
    expect(screen.getByText('Connection lost. Reconnecting…')).toBeTruthy();
  });
});

describe('SourceTextView', () => {
  function setup() {
    const sample = sampleArgument();
    const index = indexArgument(sample.graph, sample.spans);
    const stub: Mutable<SourceTextScreen> & {
      select: ReturnType<typeof vi.fn>;
      hover: ReturnType<typeof vi.fn>;
    } = observable(
      {
        sourceText: sample.document.source_text,
        index,
        highlight: NO_HIGHLIGHT,
        selection: null as Selection | null,
        scrollRequest: null,
        select: vi.fn(),
        hover: vi.fn(),
      },
      { select: false, hover: false },
    );
    const span = (ordinal: number): SpanId => {
      const id = sample.ids.spans[ordinal];
      if (id === undefined) throw new Error(`no span ${String(ordinal)}`);
      return id;
    };
    return { ...sample, index, stub, span };
  }

  it('renders the text exactly as submitted, Markdown syntax included', () => {
    const { stub, document } = setup();
    const { container } = render(<SourceTextView screen={stub} />);
    expect(container.textContent).toBe(document.source_text);
  });

  it('makes only spans that carry claims interactive', () => {
    const { stub } = setup();
    render(<SourceTextView screen={stub} />);
    // Five sentences carry claims; the heading does not.
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('selects a span on click and on Enter', async () => {
    const user = userEvent.setup();
    const { stub, span } = setup();
    render(<SourceTextView screen={stub} />);

    const fact = screen.getByRole('button', { name: /The tenant emailed the landlord/ });
    await user.click(fact);
    expect(stub.select).toHaveBeenLastCalledWith({ type: 'span', id: span(3) }, 'source');

    fact.focus();
    await user.keyboard('{Enter}');
    expect(stub.select).toHaveBeenCalledTimes(2);
  });

  it('highlights the spans of the highlighted claims', () => {
    const { stub, index, ids, span } = setup();
    stub.highlight = highlightFor(index, { type: 'claim', id: ids.rule });
    const { container } = render(<SourceTextView screen={stub} />);

    const lit = container.querySelectorAll('[data-highlighted]');
    expect([...lit].map((element) => element.getAttribute('data-span-id'))).toEqual([span(2)]);
  });

  it('previews on hover', async () => {
    const user = userEvent.setup();
    const { stub, span } = setup();
    render(<SourceTextView screen={stub} />);

    await user.hover(screen.getByRole('button', { name: /The tenant emailed the landlord/ }));
    expect(stub.hover).toHaveBeenLastCalledWith({ type: 'span', id: span(3) });
  });
});
