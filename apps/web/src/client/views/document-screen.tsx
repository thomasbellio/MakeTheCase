'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { observer } from 'mobx-react-lite';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { DocumentId } from '@make-your-case/domain';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Skeleton } from '../../components/ui/skeleton';
import { HttpApiClient, type ApiClient } from '../api/api-client';
import type { LayoutFn } from '../viewmodels/argument-map-view-model';
import { DocumentAnalysisViewModel } from '../viewmodels/document-analysis-view-model';
import { ArgumentMapView } from './argument-map-view';
import { FindingsPanel } from './findings-panel';
import { InspectorPanel } from './inspector-panel';
import { RunTimeline } from './run-timeline';
import { SourceTextView } from './source-text-view';
import { createViewModelContext } from './view-model-context';

const [Provider, useDocumentAnalysis] =
  createViewModelContext<DocumentAnalysisViewModel>('DocumentAnalysis');
export { useDocumentAnalysis };

function createLayout(): LayoutFn {
  // The bundled build runs on the main thread. The graphs are small (a brief
  // is tens of claims), so a worker would add setup for no visible gain.
  const elk = new ELK();
  return (graph) => elk.layout(graph);
}

/** The document screen (`/documents/[id]`): owns its ViewModel and disposes it on unmount. */
export function DocumentScreen({
  documentId,
  api,
}: {
  documentId: DocumentId;
  /** Injected by tests; the page uses the real client. */
  api?: ApiClient;
}) {
  const [vm] = useState(
    () => new DocumentAnalysisViewModel(api ?? new HttpApiClient(), documentId, createLayout()),
  );

  // One session per mount; its cleanup closes the event stream. Strict Mode
  // mounts twice in development, and the second session is the one that shows.
  useEffect(() => vm.activate(), [vm]);

  return (
    <Provider value={vm}>
      <DocumentBody />
    </Provider>
  );
}

const DocumentBody = observer(function DocumentBody() {
  const vm = useDocumentAnalysis();
  const { phase } = vm;

  if (phase.kind === 'complete') return <AnalysisLayout />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← New analysis
        </Link>
        {phase.kind === 'loading' && vm.detail === null ? (
          <Skeleton className="h-7 w-64" />
        ) : (
          <h1 className="font-heading text-xl font-semibold">{vm.title}</h1>
        )}
      </header>

      {phase.kind === 'error' && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>The document could not be shown</AlertTitle>
          <AlertDescription>{phase.message}</AlertDescription>
        </Alert>
      )}

      {phase.kind === 'no_run' && (
        <p className="text-sm text-muted-foreground">This document has not been analyzed.</p>
      )}

      {phase.kind === 'not_an_argument' && (
        <Alert role="status">
          <AlertTitle>No argument to map</AlertTitle>
          <AlertDescription>
            <p>Too little of this text argues for a conclusion to build an argument map from it.</p>
            <p className="mt-2">{phase.summary}</p>
          </AlertDescription>
        </Alert>
      )}

      {phase.kind === 'failed' && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>The analysis did not finish</AlertTitle>
          <AlertDescription>{phase.message}</AlertDescription>
        </Alert>
      )}

      {vm.progress !== null && <RunTimeline progress={vm.progress} />}

      {phase.kind === 'loading' && vm.progress === null && vm.detail !== null && (
        <Skeleton className="h-40 w-full" aria-label="Loading the analysis" />
      )}
    </div>
  );
});

/** Source text, map, and findings with the inspector (AGENTS.md section 9.2). */
const AnalysisLayout = observer(function AnalysisLayout() {
  const vm = useDocumentAnalysis();
  const { map, findings, inspector } = vm;

  return (
    <div className="grid flex-1 grid-cols-1 gap-px bg-border lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)_minmax(18rem,1fr)]">
      <section aria-labelledby="source-heading" className="flex min-h-0 flex-col bg-background">
        <PanelHeading id="source-heading">
          <Link href="/" className="mr-2 text-muted-foreground hover:underline">
            ←
          </Link>
          {vm.title}
        </PanelHeading>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <SourceTextView screen={vm} />
        </div>
      </section>

      <section aria-labelledby="map-heading" className="flex min-h-[32rem] flex-col bg-background">
        <PanelHeading id="map-heading">Argument map</PanelHeading>
        <div className="min-h-0 flex-1">{map !== null && <ArgumentMapView map={map} />}</div>
      </section>

      <div className="flex min-h-0 flex-col bg-background">
        <section
          aria-labelledby="inspector-heading"
          className="flex max-h-[50%] min-h-0 flex-col border-b"
        >
          <PanelHeading id="inspector-heading">Details</PanelHeading>
          <div className="min-h-0 overflow-y-auto p-4">
            {inspector !== null && <InspectorPanel inspector={inspector} />}
          </div>
        </section>
        <section aria-labelledby="findings-heading" className="flex min-h-0 flex-1 flex-col">
          <PanelHeading id="findings-heading">
            Findings {findings !== null && `(${String(findings.count)})`}
          </PanelHeading>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {findings !== null && <FindingsPanel findings={findings} />}
          </div>
        </section>
      </div>
    </div>
  );
});

function PanelHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="border-b px-4 py-2 text-sm font-semibold">
      {children}
    </h2>
  );
}
