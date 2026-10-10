import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import type { Edge, Node } from '@xyflow/react';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { ClaimId, InferenceId } from '@make-your-case/domain';
import type { ArgumentIndex } from '../model/argument-index.ts';
import type { Highlight, Selection } from '../model/highlight.ts';
import {
  buildMapGraph,
  positionMap,
  toElkGraph,
  type MapEdgeData,
  type MapGraph,
  type MapNodeData,
  type MapNodeType,
  type PositionedMap,
} from '../model/map-graph.ts';
import type { SelectionSource } from './selection.ts';

/** Runs a layout; injected so tests and the app can supply their own ELK. */
export type LayoutFn = (graph: ElkNode) => Promise<ElkNode>;

/** What the map needs from the screen: the shared selection, and a way to change it. */
export interface MapScreen {
  readonly selection: Selection | null;
  readonly highlight: Highlight;
  select(selection: Selection | null, source: SelectionSource): void;
}

export type LayoutState = 'pending' | 'ready' | 'error';

/**
 * The argument map (AGENTS.md section 9.2). Computes React Flow nodes and
 * edges and runs the ELK layout; the View only renders them.
 *
 * Highlight and selection are folded into each node's `data` here, so the
 * node components stay purely presentational.
 */
export class ArgumentMapViewModel {
  layoutState: LayoutState = 'pending';
  /** Increments with each request, so asking twice for the same nodes still refits. */
  fitRequest: { readonly nodeIds: readonly string[]; readonly token: number } | null = null;

  private positioned: PositionedMap | null = null;
  private readonly graph: MapGraph;
  private readonly runLayout: LayoutFn;
  private readonly screen: MapScreen;

  constructor(index: ArgumentIndex, runLayout: LayoutFn, screen: MapScreen) {
    this.graph = buildMapGraph(index);
    this.runLayout = runLayout;
    this.screen = screen;
    makeAutoObservable<this, 'positioned' | 'graph' | 'runLayout' | 'screen'>(
      this,
      {
        positioned: observableRef,
        fitRequest: observableRef,
        graph: false,
        runLayout: false,
        screen: false,
      },
      { autoBind: true },
    );
  }

  async layout(): Promise<void> {
    try {
      const result = await this.runLayout(toElkGraph(this.graph));
      const positioned = positionMap(this.graph, result);
      runInAction(() => {
        this.positioned = positioned;
        this.layoutState = 'ready';
      });
    } catch {
      runInAction(() => {
        this.layoutState = 'error';
      });
    }
  }

  get nodes(): Node<MapNodeData, MapNodeType>[] {
    const { highlight, selection } = this.screen;
    return (this.positioned?.nodes ?? []).map((node) => {
      const { data } = node;
      if (data.kind === 'group') return node;
      const id = data.kind === 'claim' ? data.claimId : data.inferenceId;
      const highlighted = isHighlighted(highlight, data);
      const selected = selection?.type === data.kind && selection.id === id;
      if (highlighted === data.highlighted && selected === data.selected) return node;
      // `selected` on the node too, so React Flow's own selection (and its
      // `aria-selected`) agrees with the screen's.
      return { ...node, selected, data: { ...data, highlighted, selected } };
    });
  }

  get edges(): Edge<MapEdgeData>[] {
    const { highlight } = this.screen;
    const lit = (id: string): boolean =>
      highlight.claims.has(id as ClaimId) || highlight.inferences.has(id as InferenceId);
    return (this.positioned?.edges ?? []).map((edge) => {
      const { data } = edge;
      const highlighted = lit(edge.source) && lit(edge.target);
      return data === undefined || data.highlighted === highlighted
        ? edge
        : { ...edge, data: { ...data, highlighted } };
    });
  }

  /** A node was clicked or activated with the keyboard. */
  selectNode(nodeId: string): void {
    const data = this.graph.nodes.find((node) => node.id === nodeId)?.data;
    if (data?.kind === 'claim') this.screen.select({ type: 'claim', id: data.claimId }, 'map');
    if (data?.kind === 'inference') {
      this.screen.select({ type: 'inference', id: data.inferenceId }, 'map');
    }
  }

  isSelected(nodeId: string): boolean {
    return this.screen.selection?.id === nodeId;
  }

  clearSelection(): void {
    this.screen.select(null, 'map');
  }

  /** Asks the View to bring these elements into view. */
  focus(highlight: Highlight): void {
    const nodeIds = [...highlight.claims, ...highlight.inferences];
    if (nodeIds.length === 0) return;
    this.fitRequest = { nodeIds, token: (this.fitRequest?.token ?? 0) + 1 };
  }
}

function isHighlighted(
  highlight: Highlight,
  data: Exclude<MapNodeData, { kind: 'group' }>,
): boolean {
  return data.kind === 'claim'
    ? highlight.claims.has(data.claimId)
    : highlight.inferences.has(data.inferenceId);
}
