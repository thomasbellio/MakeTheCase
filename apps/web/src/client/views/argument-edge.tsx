'use client';

import { memo, type CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import type { MapEdgeData, MapEdgeKind } from '../model/map-graph';
import { RELATION_LABELS } from '../model/map-graph';

/**
 * Support edges are plain; each relation type has its own dash pattern **and**
 * a text label (AGENTS.md section 9.3), so the type is never carried by colour
 * alone.
 */
const DASH: Record<MapEdgeKind, string | undefined> = {
  premise: undefined,
  conclusion: undefined,
  rebut: undefined,
  undermine: '8 4',
  undercut: '2 4',
  qualify: '12 4 2 4',
};

export const ArgumentEdge = memo(function ArgumentEdge(props: EdgeProps<Edge<MapEdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const kind = data?.kind ?? 'premise';
  const relation = kind !== 'premise' && kind !== 'conclusion';
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const style: CSSProperties = {
    stroke: relation ? 'var(--opposing)' : 'var(--muted-foreground)',
    strokeWidth: data?.highlighted === true ? 2.5 : relation ? 1.75 : 1.25,
    // An inferred premise's edge is dashed, like the premise itself.
    strokeDasharray: data?.inferred === true ? '5 4' : DASH[kind],
    ...(data?.highlighted === true && !relation ? { stroke: 'var(--foreground)' } : {}),
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        {...(props.markerEnd === undefined ? {} : { markerEnd: props.markerEnd })}
      />
      {relation && (
        <EdgeLabelRenderer>
          <span
            className="nodrag nopan pointer-events-none absolute rounded bg-background px-1 text-[0.6875rem] font-medium text-opposing"
            style={{
              transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
            }}
          >
            {RELATION_LABELS[kind]}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const EDGE_TYPES = { argument: ArgumentEdge };
