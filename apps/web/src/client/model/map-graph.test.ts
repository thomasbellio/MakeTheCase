import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { sampleArgument } from '../testing/sample-argument.ts';
import { indexArgument } from './argument-index.ts';
import {
  buildMapGraph,
  estimateClaimHeight,
  groupId,
  positionMap,
  toElkGraph,
  type ClaimNodeData,
} from './map-graph.ts';

function sampleMap() {
  const sample = sampleArgument();
  const index = indexArgument(sample.graph, sample.spans);
  return { ...sample, index, map: buildMapGraph(index) };
}

describe('buildMapGraph', () => {
  it('makes one node per claim and per inference, plus a group for opposing material', () => {
    const { map, graph } = sampleMap();

    const kinds = map.nodes.map((node) => node.data.kind);
    expect(kinds.filter((k) => k === 'claim')).toHaveLength(graph.claims.length);
    expect(kinds.filter((k) => k === 'inference')).toHaveLength(graph.inferences.length);
    expect(map.nodes[0]).toMatchObject({
      id: groupId('opposing'),
      data: { kind: 'group', label: 'Opposing party' },
    });
  });

  it('puts opposing claims in the opposing group and author claims at the top level', () => {
    const { map, ids } = sampleMap();
    const parent = (id: string) => map.nodes.find((node) => node.id === id)?.parent;

    expect(parent(ids.objection)).toBe(groupId('opposing'));
    expect(parent(ids.thesis)).toBeNull();
    expect(parent(ids.step)).toBeNull();
  });

  it('carries the visual facts each claim needs', () => {
    const { map, ids } = sampleMap();
    const data = (id: string) =>
      map.nodes.find((node) => node.id === id)?.data as ClaimNodeData | undefined;

    expect(data(ids.thesis)).toMatchObject({ isThesis: true, loadBearing: false });
    expect(data(ids.bridge)).toMatchObject({
      origin: 'inferred',
      loadBearing: true,
      criticalCount: 1,
    });
    expect(data(ids.fact)).toMatchObject({ uncited: true, loadBearing: true });
    expect(data(ids.rule)).toMatchObject({ uncited: false, claimKind: 'legal_rule' });
  });

  it('joins premises through the inference node to the conclusion', () => {
    const { map, ids } = sampleMap();
    const edges = map.edges.map((edge) => [edge.source, edge.target, edge.data.kind]);

    expect(edges).toEqual(
      expect.arrayContaining([
        [ids.rule, ids.step, 'premise'],
        [ids.fact, ids.step, 'premise'],
        [ids.bridge, ids.step, 'premise'],
        [ids.step, ids.thesis, 'conclusion'],
        [ids.objection, ids.step, 'undercut'],
      ]),
    );
    expect(map.edges.find((edge) => edge.source === ids.bridge)?.data.inferred).toBe(true);
    expect(map.edges.find((edge) => edge.source === ids.rule)?.data.inferred).toBe(false);
  });

  it('is the same however the rows arrive', () => {
    const sample = sampleArgument();
    const shuffled = {
      ...sample.graph,
      claims: [...sample.graph.claims].reverse(),
      premises: [...sample.graph.premises].reverse(),
    };
    expect(buildMapGraph(indexArgument(shuffled, sample.spans))).toEqual(
      buildMapGraph(indexArgument(sample.graph, sample.spans)),
    );
  });
});

describe('estimateClaimHeight', () => {
  it('grows with the text', () => {
    expect(estimateClaimHeight('x'.repeat(200))).toBeGreaterThan(estimateClaimHeight('short'));
  });
});

describe('layout', () => {
  it('lays the map out with the thesis above its premises and groups around their members', async () => {
    const { map, ids } = sampleMap();

    const layout = await new ELK().layout(toElkGraph(map));
    const { nodes, edges } = positionMap(map, layout);

    const at = (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (node === undefined) throw new Error(`no node ${id}`);
      return node;
    };
    // Support flows upward: smaller y is higher on the screen.
    expect(at(ids.thesis).position.y).toBeLessThan(at(ids.step).position.y);
    expect(at(ids.step).position.y).toBeLessThan(at(ids.rule).position.y);

    const group = at(groupId('opposing'));
    expect(group.width).toBeGreaterThan(0);
    expect(at(ids.objection)).toMatchObject({ parentId: group.id, extent: 'parent' });
    expect(group.selectable).toBe(false);

    expect(edges.every((edge) => edge.type === 'argument')).toBe(true);
    expect(at(ids.bridge).ariaLabel).toMatch(/^Inferred, Load-bearing: /);
  });
});
