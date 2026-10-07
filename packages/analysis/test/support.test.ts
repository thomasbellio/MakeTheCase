import { describe, expect, it } from 'vitest';
import { localId, toView, type ArgumentGraphDraft } from '@make-your-case/domain';
import { indexGraph } from '../src/graph/index-graph.ts';
import { buildSupportModel } from '../src/graph/support.ts';
import { graph } from './fixtures/builder.ts';

const model = (draft: ArgumentGraphDraft) => {
  const view = toView(draft);
  return buildSupportModel(view, indexGraph(view));
};

describe('support semantics', () => {
  it('treats a lone thesis as supported and nothing as load-bearing', () => {
    // The degenerate argument AGENTS.md section 7.3 allows.
    const m = model(graph().thesis('c1', 'A bare assertion').build());
    expect(m.thesisSupported).toBe(true);
    expect([...m.loadBearingClaimIds]).toEqual([]);
  });

  it('carries support up a chain, and every link is load-bearing', () => {
    const m = model(
      graph()
        .claim('c1', 'A fact')
        .claim('c2', 'An intermediate conclusion')
        .thesis('c3', 'The thesis')
        .infer('i1', ['c1'], 'c2')
        .infer('i2', ['c2'], 'c3')
        .build(),
    );
    expect(m.thesisSupported).toBe(true);
    expect([...m.loadBearingClaimIds].sort()).toEqual(['c1', 'c2']);
  });

  it('requires all of an inference premises jointly', () => {
    const m = model(
      graph()
        .claim('c1', 'First premise')
        .claim('c2', 'Second premise')
        .thesis('c3', 'The thesis')
        .infer('i1', ['c1', 'c2'], 'c3')
        .build(),
    );
    // Neither premise alone carries the step, so losing either is fatal.
    expect([...m.loadBearingClaimIds].sort()).toEqual(['c1', 'c2']);
  });

  it('treats separate inferences into one conclusion as alternatives', () => {
    const m = model(
      graph()
        .claim('c1', 'First route')
        .claim('c2', 'Second route')
        .thesis('c3', 'The thesis')
        .infer('i1', ['c1'], 'c3')
        .infer('i2', ['c2'], 'c3')
        .build(),
    );
    expect(m.thesisSupported).toBe(true);
    // Either route alone suffices, so neither claim is indispensable.
    expect([...m.loadBearingClaimIds]).toEqual([]);
  });

  it('gives an argument no credit for assuming its own conclusion', () => {
    // c1 and c2 support each other and nothing else supports either.
    const m = model(
      graph()
        .claim('c1', 'Each supports the other')
        .claim('c2', 'And the other supports it')
        .thesis('c3', 'The thesis')
        .infer('i1', ['c2'], 'c1')
        .infer('i2', ['c1'], 'c2')
        .infer('i3', ['c1'], 'c3')
        .build(),
    );
    // Least fixed point: neither cycle member is derivable from the ground up.
    expect(m.derivable.has(localId('c1'))).toBe(false);
    expect(m.derivable.has(localId('c2'))).toBe(false);
    expect(m.thesisGrounded).toBe(false);
    // But the cycle is seeded so load-bearing stays meaningful.
    expect(m.thesisSupported).toBe(true);
    expect(m.cycles).toHaveLength(1);
  });

  it('excludes opposing material from support entirely', () => {
    const m = model(
      graph()
        .claim('c1', "The author's premise")
        .opposing('c2', "The opponent's claim")
        .thesis('c3', 'The thesis')
        .infer('i1', ['c1'], 'c3')
        .relate('r1', 'rebut', 'c2', { claim: 'c3' })
        .build(),
    );
    expect(m.authorClaimIds.has(localId('c2'))).toBe(false);
    // Attacks do not affect support in v1, so the rebut changes nothing.
    expect(m.thesisSupported).toBe(true);
    expect([...m.loadBearingClaimIds]).toEqual(['c1']);
  });
});

describe('support at scale', () => {
  it('handles a long chain, with every link load-bearing', () => {
    const LINKS = 500;
    const b = graph().claim('c0', 'The ground');
    for (let i = 1; i <= LINKS; i += 1) {
      b.claim(`c${String(i)}`, `Step ${String(i)}`);
    }
    b.thesis(`c${String(LINKS + 1)}`, 'The thesis');
    for (let i = 0; i <= LINKS; i += 1) {
      b.infer(`i${String(i)}`, [`c${String(i)}`], `c${String(i + 1)}`);
    }

    const started = performance.now();
    const m = model(b.build());
    const elapsed = performance.now() - started;

    expect(m.thesisSupported).toBe(true);
    // Every link but the thesis itself.
    expect(m.loadBearingClaimIds.size).toBe(LINKS + 1);
    // Brute-force removal is O(claims x graph); this guards a regression into
    // something worse, not a precise budget.
    expect(elapsed).toBeLessThan(10_000);
  });

  it('handles a wide fan-in, where no single route is load-bearing', () => {
    const ROUTES = 200;
    const b = graph();
    for (let i = 0; i < ROUTES; i += 1) {
      b.claim(`c${String(i)}`, `Route ${String(i)}`);
    }
    b.thesis(`c${String(ROUTES)}`, 'The thesis');
    for (let i = 0; i < ROUTES; i += 1) {
      b.infer(`i${String(i)}`, [`c${String(i)}`], `c${String(ROUTES)}`);
    }

    const m = model(b.build());
    expect(m.thesisSupported).toBe(true);
    expect([...m.loadBearingClaimIds]).toEqual([]);
  });

  it('terminates on a large cycle', () => {
    const SIZE = 50;
    const b = graph();
    for (let i = 0; i < SIZE; i += 1) {
      b.claim(`c${String(i)}`, `Cycle member ${String(i)}`);
    }
    b.thesis(`c${String(SIZE)}`, 'The thesis');
    for (let i = 0; i < SIZE; i += 1) {
      // Each member is concluded from the previous, closing the loop.
      b.infer(`i${String(i)}`, [`c${String((i + SIZE - 1) % SIZE)}`], `c${String(i)}`);
    }
    b.infer(`i${String(SIZE)}`, ['c0'], `c${String(SIZE)}`);

    const started = performance.now();
    const m = model(b.build());
    const elapsed = performance.now() - started;

    expect(m.cycles).toHaveLength(1);
    expect(m.cycles[0]?.claimIds).toHaveLength(SIZE);
    expect(m.thesisGrounded).toBe(false);
    expect(elapsed).toBeLessThan(10_000);
  });
});
