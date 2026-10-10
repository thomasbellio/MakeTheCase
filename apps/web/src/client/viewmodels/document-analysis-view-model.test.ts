import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import {
  newId,
  type AnalysisRun,
  type DocumentDetail,
  type RunEvent,
  type RunId,
  type SpanId,
} from '@make-your-case/domain';
import { FakeApiClient } from '../api/testing/fake-api-client.ts';
import { sampleArgument } from '../testing/sample-argument.ts';
import type { LayoutFn } from './argument-map-view-model.ts';
import { DocumentAnalysisViewModel } from './document-analysis-view-model.ts';

const elk = new ELK();
const layout: LayoutFn = (graph) => elk.layout(graph);

/** Lets pending promise chains (fetch → runInAction → layout) settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function completedSetup() {
  const sample = sampleArgument();
  const api = new FakeApiClient();
  api.details.set(sample.document.id, {
    ok: true,
    value: { document: sample.document, spans: sample.spans, latestRun: sample.run },
  });
  api.arguments.set(sample.document.id, { ok: true, value: sample.graph });
  const vm = new DocumentAnalysisViewModel(api, sample.document.id, layout);
  const span = (ordinal: number): SpanId => {
    const id = sample.ids.spans[ordinal];
    if (id === undefined) throw new Error(`no span ${String(ordinal)}`);
    return id;
  };
  return { ...sample, api, vm, span };
}

function runWith(status: AnalysisRun['status'], fields: Partial<AnalysisRun> = {}) {
  const sample = sampleArgument();
  const run: AnalysisRun = {
    ...sample.run,
    id: newId<RunId>(),
    status,
    revision_id: null,
    finished_at: null,
    ...fields,
  };
  const api = new FakeApiClient();
  const pending: DocumentDetail = { document: sample.document, spans: [], latestRun: run };
  api.details.set(sample.document.id, { ok: true, value: pending });
  const vm = new DocumentAnalysisViewModel(api, sample.document.id, layout);
  return { ...sample, api, vm, run };
}

function event(runId: RunId, sequence: number, fields: Partial<RunEvent>): RunEvent {
  return {
    id: newId(),
    run_id: runId,
    sequence,
    stage: null,
    type: 'stage_started',
    payload: null,
    created_at: new Date(),
    ...fields,
  };
}

describe('loading', () => {
  it('shows a completed analysis with its map laid out', async () => {
    const { vm } = completedSetup();
    await vm.load();
    await settle();

    expect(vm.phase.kind).toBe('complete');
    expect(vm.map?.layoutState).toBe('ready');
    expect(vm.map?.nodes.length).toBeGreaterThan(0);
    expect(vm.findings?.count).toBe(7);
  });

  it('reports a document that cannot be loaded', async () => {
    const api = new FakeApiClient();
    const vm = new DocumentAnalysisViewModel(api, sampleArgument().document.id, layout);
    await vm.load();
    expect(vm.phase).toEqual({ kind: 'error', message: 'no such document' });
  });

  it('shows the summary of a run that found no argument', async () => {
    const { vm } = runWith('not_an_argument', { summary: 'A recipe.' });
    await vm.load();
    expect(vm.phase).toEqual({ kind: 'not_an_argument', summary: 'A recipe.' });
  });

  it("shows a failed run's safe message", async () => {
    const { vm } = runWith('failed', { error: 'The analysis stopped unexpectedly.' });
    await vm.load();
    expect(vm.phase).toEqual({ kind: 'failed', message: 'The analysis stopped unexpectedly.' });
  });
});

describe('following a run in progress', () => {
  it('streams progress, then loads the argument once the run completes', async () => {
    const { api, vm, run, document, spans, graph } = runWith('running');
    await vm.load();

    expect(vm.phase.kind).toBe('in_progress');
    const stream = api.streamFor(run.id);
    expect(stream.afterSequence).toBe(-1);

    stream.emit(event(run.id, 0, { type: 'stage_started', stage: 'segment' }));
    stream.emit(
      event(run.id, 1, { type: 'stage_completed', stage: 'segment', payload: { spans: 6 } }),
    );
    expect(vm.progress?.timeline.stages[0]).toMatchObject({ state: 'done', detail: '6 sentences' });

    // The analysis is saved: spans now exist, and so does the argument.
    const done = { ...run, status: 'completed' as const };
    api.runs.set(run.id, { ok: true, value: done });
    api.details.set(document.id, { ok: true, value: { document, spans, latestRun: done } });
    api.arguments.set(document.id, { ok: true, value: graph });
    stream.end('completed');
    await settle();

    expect(vm.phase.kind).toBe('complete');
    expect(vm.index?.spans).toHaveLength(spans.length);
    expect(stream.closed).toBe(true);
  });

  it('shows the summary when the run ends as not an argument', async () => {
    const { api, vm, run } = runWith('running');
    await vm.load();

    api.runs.set(run.id, {
      ok: true,
      value: { ...run, status: 'not_an_argument', summary: 'Assembly instructions.' },
    });
    api.streamFor(run.id).end('not_an_argument');
    await settle();

    expect(vm.phase).toEqual({ kind: 'not_an_argument', summary: 'Assembly instructions.' });
  });

  it("shows the run's error when it fails, falling back to the streamed message", async () => {
    const { api, vm, run } = runWith('queued');
    await vm.load();
    const stream = api.streamFor(run.id);

    stream.emit(
      event(run.id, 0, { type: 'run_failed', payload: { message: 'Could not reconstruct.' } }),
    );
    // The status fetch fails, so the streamed message is all there is.
    stream.end('failed');
    await settle();

    expect(vm.phase).toEqual({ kind: 'failed', message: 'Could not reconstruct.' });
  });

  it('records reconnection so the View can say so', async () => {
    const { api, vm, run } = runWith('running');
    await vm.load();

    api.streamFor(run.id).connection('reconnecting');
    expect(vm.progress?.connection).toBe('reconnecting');
    api.streamFor(run.id).connection('open');
    expect(vm.progress?.connection).toBe('open');
  });

  it('closes the stream when the screen is disposed', async () => {
    const { api, vm, run } = runWith('running');
    await vm.load();

    vm.dispose();

    expect(api.streamFor(run.id).closed).toBe(true);
  });
});

describe('selection syncing', () => {
  it('selecting a span highlights its claims and refits the map, without scrolling the text', async () => {
    const { vm, ids, span } = completedSetup();
    await vm.load();
    await settle();

    vm.select({ type: 'span', id: span(3) }, 'source');

    expect([...vm.highlight.claims]).toEqual([ids.fact]);
    expect(vm.scrollRequest).toBeNull();
    expect(vm.map?.fitRequest?.nodeIds).toEqual([ids.fact]);
    expect(vm.map?.nodes.find((n) => n.id === ids.fact)?.data).toMatchObject({ highlighted: true });
  });

  it('selecting a claim on the map scrolls the text to it, without refitting the map', async () => {
    const { vm, ids, span } = completedSetup();
    await vm.load();
    await settle();

    vm.map?.selectNode(ids.rule);

    expect(vm.selection).toEqual({ type: 'claim', id: ids.rule });
    expect(vm.scrollRequest?.spanId).toBe(span(2));
    expect(vm.map?.fitRequest).toBeNull();
    expect(vm.map?.nodes.find((n) => n.id === ids.rule)?.data).toMatchObject({ selected: true });
    expect(vm.inspector?.details).toMatchObject({ type: 'claim', claim: { id: ids.rule } });
  });

  it('selecting the same element again clears it', async () => {
    const { vm, ids } = completedSetup();
    await vm.load();
    await settle();

    vm.map?.selectNode(ids.rule);
    vm.map?.selectNode(ids.rule);

    expect(vm.selection).toBeNull();
    expect(vm.inspector?.details).toBeNull();
  });

  it('a hover previews without changing the selection', async () => {
    const { vm, ids, span } = completedSetup();
    await vm.load();
    await settle();
    vm.select({ type: 'claim', id: ids.rule }, 'map');

    vm.hover({ type: 'span', id: span(3) });
    expect([...vm.highlight.claims]).toEqual([ids.fact]);
    expect(vm.selection).toEqual({ type: 'claim', id: ids.rule });

    vm.hover(null);
    expect([...vm.highlight.claims]).toEqual([ids.rule]);
  });

  it('every scroll and fit request is new, even for the same element', async () => {
    const { vm, ids } = completedSetup();
    await vm.load();
    await settle();

    vm.select({ type: 'claim', id: ids.fact }, 'inspector');
    const first = vm.scrollRequest?.token;
    vm.select({ type: 'claim', id: ids.thesis }, 'inspector');
    vm.select({ type: 'claim', id: ids.fact }, 'inspector');

    expect(vm.scrollRequest?.token).toBe((first ?? 0) + 2);
  });
});

describe('findings focus', () => {
  it('focusing a finding selects it, scrolls the text and refits the map to its targets', async () => {
    const { vm, ids, span } = completedSetup();
    await vm.load();
    await settle();
    const findings = vm.findings;
    if (findings === null) throw new Error('no findings');

    const uncited = findings.items.find((item) => item.finding.kind === 'unsupported_claim');
    if (uncited === undefined) throw new Error('fixture has no uncited finding');
    findings.focus(uncited.finding.id);

    expect(vm.selection).toEqual({ type: 'finding', id: uncited.finding.id });
    expect(vm.scrollRequest?.spanId).toBe(span(3));
    expect(vm.map?.fitRequest?.nodeIds).toEqual([ids.fact]);
    expect(findings.selectedId).toBe(uncited.finding.id);
    expect(findings.activeIndex).toBe(findings.indexOf(uncited.finding.id));
  });

  it('groups findings by severity, most severe first', async () => {
    const { vm } = completedSetup();
    await vm.load();
    await settle();

    expect(vm.findings?.groups.map((g) => [g.severity, g.items.length])).toEqual([
      ['critical', 1],
      ['warning', 1],
      ['info', 5],
    ]);
  });

  it('moves through findings with the keyboard and focuses the active one', async () => {
    const { vm } = completedSetup();
    await vm.load();
    await settle();
    const findings = vm.findings;
    if (findings === null) throw new Error('no findings');

    findings.moveNext();
    findings.moveNext();
    findings.movePrevious();
    findings.focusActive();
    expect(vm.selection).toEqual({ type: 'finding', id: findings.items[1]?.finding.id });

    findings.moveLast();
    findings.moveNext();
    expect(findings.activeIndex).toBe(findings.count - 1);
    findings.moveFirst();
    findings.movePrevious();
    expect(findings.activeIndex).toBe(0);
  });

  it('a finding focused twice stays selected', async () => {
    const { vm } = completedSetup();
    await vm.load();
    await settle();
    const id = vm.findings?.items[0]?.finding.id;
    if (id === undefined) throw new Error('no findings');

    vm.findings?.focus(id);
    vm.findings?.focus(id);

    expect(vm.selection).toEqual({ type: 'finding', id });
  });
});

describe('inspector', () => {
  it('describes an inference with its premises and the attack on it', async () => {
    const { vm, ids } = completedSetup();
    await vm.load();
    await settle();

    vm.select({ type: 'inference', id: ids.step }, 'map');
    const details = vm.inspector?.details;

    if (details?.type !== 'inference') throw new Error('expected inference details');
    expect(details.premises.map((c) => c.id)).toEqual([ids.rule, ids.fact, ids.bridge]);
    expect(details.conclusion?.id).toBe(ids.thesis);
    expect(details.incoming.map((r) => [r.relation.type, r.other?.id])).toEqual([
      ['undercut', ids.objection],
    ]);
  });

  it("describes a claim's occurrences, findings and role", async () => {
    const { vm, ids } = completedSetup();
    await vm.load();
    await settle();

    vm.inspector?.selectClaim(ids.fact);
    const details = vm.inspector?.details;

    if (details?.type !== 'claim') throw new Error('expected claim details');
    expect(details.occurrences.map((o) => o.surfaceText)).toEqual([
      'The tenant emailed the landlord on May 20.',
    ]);
    expect(details).toMatchObject({ loadBearing: true, uncited: true });
    expect(details.supports.map((i) => i.id)).toEqual([ids.step]);
    expect(details.findings.map((f) => f.kind).sort()).toEqual([
      'load_bearing',
      'unsupported_claim',
    ]);
  });

  it('describes a span with its text and claims', async () => {
    const { vm, ids, span } = completedSetup();
    await vm.load();
    await settle();

    vm.select({ type: 'span', id: span(4) }, 'source');

    expect(vm.inspector?.details).toMatchObject({
      type: 'span',
      text: 'The landlord argues that an email is not written notice.',
      claims: [{ id: ids.objection }],
    });
  });
});
