import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type {
  Attribution,
  ClaimId,
  ClaimKind,
  InferenceId,
  InferenceScheme,
  Modality,
  Origin,
  RelationType,
} from '@make-your-case/domain';
import type { ArgumentIndex } from './argument-index.ts';

/**
 * The argument map as data (AGENTS.md sections 9.2, 9.3), in three pure steps:
 *
 *   buildMapGraph   index      → nodes and edges with sizes, no positions
 *   toElkGraph      map graph  → ELK's input (layered, thesis on top)
 *   positionMap     ELK output → React Flow nodes and edges
 *
 * Each is tested on its own; the ViewModel only runs them in order.
 *
 * Every claim and every inference is its own node, so alternative routes
 * appear as separate inference nodes into the same conclusion. Opposing and
 * third-party material sits in labelled group nodes apart from the author's
 * support tree.
 */

export interface ClaimNodeData extends Record<string, unknown> {
  readonly kind: 'claim';
  readonly claimId: ClaimId;
  readonly text: string;
  readonly claimKind: ClaimKind;
  readonly modality: Modality;
  readonly origin: Origin;
  readonly attribution: Attribution;
  readonly isThesis: boolean;
  readonly loadBearing: boolean;
  readonly uncited: boolean;
  readonly criticalCount: number;
  readonly highlighted: boolean;
  readonly selected: boolean;
}

export interface InferenceNodeData extends Record<string, unknown> {
  readonly kind: 'inference';
  readonly inferenceId: InferenceId;
  readonly scheme: InferenceScheme;
  readonly origin: Origin;
  readonly attribution: Attribution;
  readonly premiseCount: number;
  readonly criticalCount: number;
  readonly highlighted: boolean;
  readonly selected: boolean;
}

export interface GroupNodeData extends Record<string, unknown> {
  readonly kind: 'group';
  readonly attribution: Exclude<Attribution, 'author'>;
  readonly label: string;
}

export type MapNodeData = ClaimNodeData | InferenceNodeData | GroupNodeData;

/**
 * React Flow node type names. Not `group`: that is a built-in React Flow type
 * with its own box styling, which drew a second border around ours.
 */
export const NODE_TYPE = { claim: 'claim', inference: 'inference', group: 'party' } as const;
export type MapNodeType = (typeof NODE_TYPE)[MapNodeData['kind']];

export type MapEdgeKind = 'premise' | 'conclusion' | RelationType;

export interface MapEdgeData extends Record<string, unknown> {
  readonly kind: MapEdgeKind;
  /** A premise edge whose premise the system inferred. */
  readonly inferred: boolean;
  readonly highlighted: boolean;
}

export interface MapNodeSpec {
  readonly id: string;
  readonly parent: string | null;
  readonly width: number;
  readonly height: number;
  readonly data: MapNodeData;
}

export interface MapEdgeSpec {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly data: MapEdgeData;
}

export interface MapGraph {
  readonly nodes: readonly MapNodeSpec[];
  readonly edges: readonly MapEdgeSpec[];
}

export const GROUP_LABELS: Record<Exclude<Attribution, 'author'>, string> = {
  opposing: 'Opposing party',
  third_party: 'Third party',
};

export const RELATION_LABELS: Record<RelationType, string> = {
  rebut: 'rebuts',
  undermine: 'undermines',
  undercut: 'undercuts',
  qualify: 'qualifies',
};

const CLAIM_WIDTH = 264;
const INFERENCE_WIDTH = 168;
const INFERENCE_HEIGHT = 40;
/** Rough characters per line at the claim node's text size. */
const CHARS_PER_LINE = 34;
const LINE_HEIGHT = 18;
/** One row of tags, padding and border. */
const CLAIM_CHROME = 58;
/** Tags that fit on one row at the node's width; more wrap to another row. */
const TAGS_PER_ROW = 3;
const TAG_ROW_HEIGHT = 22;

export const groupId = (attribution: Exclude<Attribution, 'author'>): string =>
  `group:${attribution}`;

/**
 * Estimated rather than measured: layout runs before anything renders, and
 * keeping DOM measurement out of the ViewModel is the point of MVVM here.
 * Generous, so text never overflows its node.
 */
export function estimateClaimHeight(text: string, tagCount = 1): number {
  const lines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
  const extraTagRows = Math.max(0, Math.ceil(tagCount / TAGS_PER_ROW) - 1);
  return CLAIM_CHROME + extraTagRows * TAG_ROW_HEIGHT + lines * LINE_HEIGHT;
}

/** How many tags `ClaimNodeView` shows, so the height estimate can allow for wrapping. */
export function claimTagCount(data: ClaimNodeData): number {
  return [
    data.isThesis,
    true, // kind
    data.origin === 'inferred',
    data.attribution !== 'author',
    data.modality !== 'asserted',
    data.loadBearing,
    data.uncited,
    data.criticalCount > 0,
  ].filter(Boolean).length;
}

export function buildMapGraph(index: ArgumentIndex): MapGraph {
  const parentOf = (attribution: Attribution): string | null =>
    attribution === 'author' ? null : groupId(attribution);

  const groups = new Set<Exclude<Attribution, 'author'>>();
  for (const element of [...index.claims, ...index.inferences]) {
    if (element.attribution !== 'author') groups.add(element.attribution);
  }

  const nodes: MapNodeSpec[] = [
    // Parents precede their children, as React Flow requires.
    ...[...groups].sort().map((attribution) => ({
      id: groupId(attribution),
      parent: null,
      width: 0,
      height: 0,
      data: { kind: 'group', attribution, label: GROUP_LABELS[attribution] } as const,
    })),
    ...index.claims.map((claim): MapNodeSpec => {
      const data: ClaimNodeData = {
        kind: 'claim',
        claimId: claim.id,
        text: claim.canonical_text,
        claimKind: claim.kind,
        modality: claim.modality,
        origin: claim.origin,
        attribution: claim.attribution,
        isThesis: claim.is_thesis,
        loadBearing: index.loadBearing.has(claim.id),
        uncited: index.uncited.has(claim.id),
        criticalCount: index.criticalCount.get(claim.id) ?? 0,
        highlighted: false,
        selected: false,
      };
      return {
        id: claim.id,
        parent: parentOf(claim.attribution),
        width: CLAIM_WIDTH,
        height: estimateClaimHeight(claim.canonical_text, claimTagCount(data)),
        data,
      };
    }),
    ...index.inferences.map((inference): MapNodeSpec => ({
      id: inference.id,
      parent: parentOf(inference.attribution),
      width: INFERENCE_WIDTH,
      height: INFERENCE_HEIGHT,
      data: {
        kind: 'inference',
        inferenceId: inference.id,
        scheme: inference.scheme,
        origin: inference.origin,
        attribution: inference.attribution,
        premiseCount: index.premisesOf.get(inference.id)?.length ?? 0,
        criticalCount: index.criticalCount.get(inference.id) ?? 0,
        highlighted: false,
        selected: false,
      },
    })),
  ];

  const edges: MapEdgeSpec[] = [];
  for (const inference of index.inferences) {
    for (const premise of index.premisesOf.get(inference.id) ?? []) {
      edges.push({
        id: `premise:${premise}:${inference.id}`,
        source: premise,
        target: inference.id,
        data: {
          kind: 'premise',
          inferred: index.claimById.get(premise)?.origin === 'inferred',
          highlighted: false,
        },
      });
    }
    edges.push({
      id: `conclusion:${inference.id}`,
      source: inference.id,
      target: inference.conclusion_claim_id,
      data: { kind: 'conclusion', inferred: false, highlighted: false },
    });
  }
  for (const relation of index.relations) {
    const target = relation.target_claim_id ?? relation.target_inference_id;
    if (target === null) continue;
    edges.push({
      id: `relation:${relation.id}`,
      source: relation.source_claim_id,
      target,
      data: { kind: relation.type, inferred: false, highlighted: false },
    });
  }

  return { nodes, edges };
}

/**
 * ELK's input. Layered, with edges pointing up: premises below the
 * inferences they feed, the thesis on top. Group nodes are compound nodes, and
 * `INCLUDE_CHILDREN` lets edges cross into them, so an attack from the
 * opposing group on an author inference is laid out as one graph.
 */
export function toElkGraph(graph: MapGraph): ElkNode {
  const elkNode = (spec: MapNodeSpec): ElkNode =>
    spec.data.kind === 'group'
      ? {
          id: spec.id,
          layoutOptions: {
            'elk.padding': '[top=40,left=16,bottom=16,right=16]',
            'elk.direction': 'UP',
          },
          children: graph.nodes.filter((child) => child.parent === spec.id).map(elkNode),
        }
      : { id: spec.id, width: spec.width, height: spec.height };

  const edges: ElkExtendedEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'UP',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56',
      'elk.spacing.nodeNode': '32',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      // Respect input order where the layout allows, so the reading order
      // the index computed carries through to the map.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: graph.nodes.filter((spec) => spec.parent === null).map(elkNode),
    edges,
  };
}

export interface PositionedMap {
  readonly nodes: readonly Node<MapNodeData, MapNodeType>[];
  readonly edges: readonly Edge<MapEdgeData>[];
}

/**
 * React Flow nodes from ELK's output. ELK gives a child's position relative
 * to its compound parent, which is exactly what React Flow's `parentId`
 * expects, so positions are copied as they are.
 */
export function positionMap(graph: MapGraph, layout: ElkNode): PositionedMap {
  const placed = new Map<string, ElkNode>();
  const visit = (node: ElkNode): void => {
    placed.set(node.id, node);
    node.children?.forEach(visit);
  };
  visit(layout);

  const nodes = graph.nodes.map((spec): Node<MapNodeData, MapNodeType> => {
    const at = placed.get(spec.id);
    const width = spec.data.kind === 'group' ? (at?.width ?? 0) : spec.width;
    const height = spec.data.kind === 'group' ? (at?.height ?? 0) : spec.height;
    return {
      id: spec.id,
      type: NODE_TYPE[spec.data.kind],
      position: { x: at?.x ?? 0, y: at?.y ?? 0 },
      data: spec.data,
      width,
      height,
      ...(spec.parent === null ? {} : { parentId: spec.parent, extent: 'parent' as const }),
      // Groups are containers, not argument elements: not selectable, not tab stops.
      selectable: spec.data.kind !== 'group',
      focusable: spec.data.kind !== 'group',
      draggable: false,
      ariaLabel: ariaLabelOf(spec.data),
    };
  });

  const edges = graph.edges.map((edge): Edge<MapEdgeData> => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'argument',
    data: edge.data,
    focusable: false,
    selectable: false,
    // An arrow where a step arrives: at a conclusion, or at what a relation targets.
    ...(edge.data.kind === 'premise'
      ? {}
      : {
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: edge.data.kind === 'conclusion' ? 'var(--muted-foreground)' : 'var(--opposing)',
          },
        }),
  }));

  return { nodes, edges };
}

function ariaLabelOf(data: MapNodeData): string {
  switch (data.kind) {
    case 'group':
      return data.label;
    case 'inference':
      return `${data.origin === 'inferred' ? 'Inferred ' : ''}${data.scheme} inference from ${String(data.premiseCount)} premise${data.premiseCount === 1 ? '' : 's'}`;
    case 'claim': {
      const tags = [
        data.isThesis ? 'Thesis' : null,
        data.origin === 'inferred' ? 'Inferred' : null,
        data.attribution === 'author' ? null : GROUP_LABELS[data.attribution],
        data.loadBearing ? 'Load-bearing' : null,
        data.uncited ? 'Uncited' : null,
      ].filter((tag) => tag !== null);
      return `${tags.length > 0 ? `${tags.join(', ')}: ` : ''}${data.text}`;
    }
  }
}
