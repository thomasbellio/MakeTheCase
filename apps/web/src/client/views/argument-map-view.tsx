'use client';

import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Skeleton } from '../../components/ui/skeleton';
import type { ArgumentMapViewModel } from '../viewmodels/argument-map-view-model';
import { EDGE_TYPES } from './argument-edge';
import { NODE_TYPES } from './map-nodes';

/** The argument map (AGENTS.md section 9.2). Renders what `ArgumentMapViewModel` computed. */
export const ArgumentMapView = observer(function ArgumentMapView({
  map,
}: {
  map: ArgumentMapViewModel;
}) {
  if (map.layoutState === 'pending') {
    return <Skeleton className="h-full min-h-96 w-full" aria-label="Laying out the argument map" />;
  }
  if (map.layoutState === 'error') {
    return (
      <p className="p-4 text-sm text-destructive">
        The argument map could not be laid out. The findings and source text are still available.
      </p>
    );
  }
  return (
    <ReactFlowProvider>
      <MapCanvas map={map} />
    </ReactFlowProvider>
  );
});

const MapCanvas = observer(function MapCanvas({ map }: { map: ArgumentMapViewModel }) {
  const flow = useReactFlow();
  const request = map.fitRequest;

  useEffect(() => {
    if (request === null) return;
    void flow.fitView({
      nodes: request.nodeIds.map((id) => ({ id })),
      duration: 300,
      padding: 0.4,
      maxZoom: 1.1,
    });
  }, [flow, request]);

  // Selection arrives as node changes, for clicks and for Enter/Space on a
  // focused node alike, so keyboard users select exactly as mouse users do.
  const onNodesChange = (changes: NodeChange[]): void => {
    const selected = changes.find((change) => change.type === 'select' && change.selected);
    if (selected !== undefined && 'id' in selected) {
      map.selectNode(selected.id);
      return;
    }
    const cleared = changes.some(
      (change) => change.type === 'select' && !change.selected && map.isSelected(change.id),
    );
    if (cleared) map.clearSelection();
  };

  return (
    <ReactFlow
      aria-label="Argument map"
      nodes={map.nodes}
      edges={map.edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onPaneClick={() => {
        map.clearSelection();
      }}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable
      edgesFocusable={false}
      elementsSelectable
      colorMode="system"
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
      minZoom={0.15}
      proOptions={{ hideAttribution: false }}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
});
