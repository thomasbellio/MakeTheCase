'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { HttpApiClient } from '../api/api-client';
import { NewAnalysisViewModel, ROLE_OPTIONS } from '../viewmodels/new-analysis-view-model';
import { RUN_STATUS_LABELS } from './labels';
import { createViewModelContext } from './view-model-context';

const [Provider, useNewAnalysis] = createViewModelContext<NewAnalysisViewModel>('NewAnalysis');

/** The new-analysis screen (`/`): owns its ViewModel for the life of the page. */
export function NewAnalysisScreen({ maxDocumentChars }: { maxDocumentChars: number }) {
  const router = useRouter();
  const [vm] = useState(() => new NewAnalysisViewModel(new HttpApiClient(), { maxDocumentChars }));

  useEffect(() => {
    void vm.loadDocuments();
    // Navigation is a View concern; the ViewModel only says where to go.
    return reaction(
      () => vm.submittedDocumentId,
      (id) => {
        if (id !== null) router.push(`/documents/${id}`);
      },
    );
  }, [vm, router]);

  return (
    <Provider value={vm}>
      <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[1fr_18rem]">
        <SubmissionForm />
        <DocumentList />
      </div>
    </Provider>
  );
}

export const SubmissionForm = observer(function SubmissionForm() {
  const vm = useNewAnalysis();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void vm.submit();
      }}
    >
      <div>
        <h1 className="font-heading text-xl font-semibold">Analyze an argument</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste persuasive writing as Markdown. You will get a map of its claims, the reasoning that
          connects them, and the premises it depends on but does not state.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Title (optional)</Label>
          <Input
            id="title"
            value={vm.title}
            onChange={(event) => {
              vm.setTitle(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">What is this text? (optional)</Label>
          {/* A native select: fully keyboard and screen-reader accessible as it is. */}
          <select
            id="role"
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            value={vm.role ?? ''}
            onChange={(event) => {
              vm.setRole(event.target.value === '' ? null : event.target.value);
            }}
          >
            <option value="">Not specified</option>
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source-text">Text</Label>
        <Textarea
          id="source-text"
          className="min-h-80 font-mono text-sm"
          value={vm.text}
          aria-describedby="source-text-count"
          aria-invalid={vm.tooLarge}
          onChange={(event) => {
            vm.setText(event.target.value);
          }}
        />
        <p
          id="source-text-count"
          className={vm.tooLarge ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
        >
          {vm.sizeMessage ??
            `${vm.charCount.toLocaleString('en-US')} of ${vm.maxDocumentChars.toLocaleString('en-US')} characters`}
        </p>
      </div>

      {vm.submitError !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{vm.submitError}</AlertDescription>
        </Alert>
      )}

      <div>
        <Button type="submit" disabled={!vm.canSubmit}>
          {vm.submitting ? 'Submitting…' : 'Analyze'}
        </Button>
      </div>
    </form>
  );
});

export const DocumentList = observer(function DocumentList() {
  const vm = useNewAnalysis();

  return (
    <Card size="sm" className="self-start">
      <CardHeader>
        <CardTitle>Earlier documents</CardTitle>
      </CardHeader>
      <CardContent>
        {vm.documentsError !== null ? (
          <p className="text-sm text-destructive">{vm.documentsError}</p>
        ) : !vm.documentsLoaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : vm.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing analyzed yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {vm.documents.map((document) => (
              <li key={document.id} className="flex items-start justify-between gap-2">
                <Link
                  href={`/documents/${document.id}`}
                  className="text-sm underline-offset-4 hover:underline"
                >
                  {document.title ?? 'Untitled document'}
                  <span className="block text-xs text-muted-foreground">
                    {document.created_at.toLocaleDateString()}
                  </span>
                </Link>
                {document.latest_run_status !== null && (
                  <Badge variant="outline">{RUN_STATUS_LABELS[document.latest_run_status]}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
});
