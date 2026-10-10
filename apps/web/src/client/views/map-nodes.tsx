'use client';

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangleIcon, AnchorIcon, FileQuestionIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  NODE_TYPE,
  type ClaimNodeData,
  type GroupNodeData,
  type InferenceNodeData,
} from '../model/map-graph';
import { ATTRIBUTION_LABELS, CLAIM_KIND_LABELS, MODALITY_LABELS, SCHEME_LABELS } from './labels';

/**
 * The map's node types (AGENTS.md section 9.3). Purely presentational: every
 * fact they show — highlight and selection included — arrives in `data`,
 * computed by `ArgumentMapViewModel`. Nothing is encoded by colour alone;
 * each state also has a border pattern, a label or an icon.
 */

/** Edges enter from below (premises) and leave from the top (conclusions). */
function Handles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        className="opacity-0"
      />
      <Handle type="source" position={Position.Top} isConnectable={false} className="opacity-0" />
    </>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-px text-[0.6875rem] leading-4 font-medium whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ClaimNodeView({ data }: { data: ClaimNodeData }) {
  const opposing = data.attribution !== 'author';
  return (
    <div
      data-testid="claim-node"
      className={cn(
        'h-full w-full rounded-lg border bg-card p-2.5 text-card-foreground shadow-xs',
        data.isThesis && 'border-2 border-foreground',
        data.loadBearing && !data.isThesis && 'border-2 border-foreground/70',
        data.origin === 'inferred' && 'border-2 border-dashed',
        opposing && 'border-opposing',
        data.highlighted && 'bg-highlight',
        data.selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
      )}
    >
      <div className="mb-1.5 flex flex-wrap gap-1">
        {data.isThesis && (
          <Tag className="border-foreground bg-foreground text-background">Thesis</Tag>
        )}
        <Tag>{CLAIM_KIND_LABELS[data.claimKind]}</Tag>
        {data.origin === 'inferred' && <Tag className="border-dashed">Inferred</Tag>}
        {opposing && (
          <Tag className="border-opposing text-opposing">
            {ATTRIBUTION_LABELS[data.attribution]}
          </Tag>
        )}
        {data.modality !== 'asserted' && <Tag>{MODALITY_LABELS[data.modality]}</Tag>}
        {data.loadBearing && (
          <Tag>
            <AnchorIcon className="size-3" aria-hidden />
            Load-bearing
          </Tag>
        )}
        {data.uncited && (
          <Tag className="border-severity-warning text-severity-warning">
            <FileQuestionIcon className="size-3" aria-hidden />
            Uncited
          </Tag>
        )}
        {data.criticalCount > 0 && <CriticalBadge count={data.criticalCount} />}
      </div>
      <p className="text-[0.8125rem] leading-[18px]">{data.text}</p>
    </div>
  );
}

export function InferenceNodeView({ data }: { data: InferenceNodeData }) {
  return (
    <div
      data-testid="inference-node"
      className={cn(
        'flex h-full w-full items-center justify-center gap-1.5 rounded-full border bg-muted px-2 text-xs',
        data.origin === 'inferred' && 'border-2 border-dashed',
        data.attribution !== 'author' && 'border-opposing',
        data.highlighted && 'bg-highlight',
        data.selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
      )}
    >
      <span className="font-medium">{SCHEME_LABELS[data.scheme]}</span>
      {data.origin === 'inferred' && <span className="text-muted-foreground">· Inferred</span>}
      {data.criticalCount > 0 && <CriticalBadge count={data.criticalCount} />}
    </div>
  );
}

export function GroupNodeView({ data }: { data: GroupNodeData }) {
  return (
    <div
      data-testid="group-node"
      className="h-full w-full rounded-xl border-2 border-dashed border-opposing/60 bg-opposing/5"
    >
      <p className="px-3 pt-2 text-xs font-semibold tracking-wide text-opposing uppercase">
        {data.label}
      </p>
    </div>
  );
}

function CriticalBadge({ count }: { count: number }) {
  return (
    <Tag className="border-severity-critical text-severity-critical">
      <AlertTriangleIcon className="size-3" aria-hidden />
      {count} critical
    </Tag>
  );
}

// React Flow wrappers: handles plus the presentational view.

export const ClaimNode = memo(function ClaimNode({ data }: NodeProps<Node<ClaimNodeData>>) {
  return (
    <>
      <Handles />
      <ClaimNodeView data={data} />
    </>
  );
});

export const InferenceNode = memo(function InferenceNode({
  data,
}: NodeProps<Node<InferenceNodeData>>) {
  return (
    <>
      <Handles />
      <InferenceNodeView data={data} />
    </>
  );
});

export const GroupNode = memo(function GroupNode({ data }: NodeProps<Node<GroupNodeData>>) {
  return <GroupNodeView data={data} />;
});

export const NODE_TYPES = {
  [NODE_TYPE.claim]: ClaimNode,
  [NODE_TYPE.inference]: InferenceNode,
  [NODE_TYPE.group]: GroupNode,
};
