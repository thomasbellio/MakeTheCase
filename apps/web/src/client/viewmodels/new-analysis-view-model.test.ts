import { describe, expect, it } from 'vitest';
import { newId, type DocumentId, type RunId } from '@make-your-case/domain';
import { failure, FakeApiClient } from '../api/testing/fake-api-client.ts';
import { NewAnalysisViewModel } from './new-analysis-view-model.ts';

function setup(maxDocumentChars = 50) {
  const api = new FakeApiClient();
  return { api, vm: new NewAnalysisViewModel(api, { maxDocumentChars }) };
}

describe('NewAnalysisViewModel', () => {
  it('cannot submit blank text', () => {
    const { vm } = setup();
    expect(vm.canSubmit).toBe(false);
    vm.setText('   ');
    expect(vm.canSubmit).toBe(false);
    vm.setText('An argument.');
    expect(vm.canSubmit).toBe(true);
  });

  it('warns about, and refuses, text over the limit before it is sent', async () => {
    const { api, vm } = setup(10);
    vm.setText('x'.repeat(11));

    expect(vm.tooLarge).toBe(true);
    expect(vm.sizeMessage).toBe(
      'The text is 11 characters long; the limit is 10. Shorten it to submit.',
    );
    await vm.submit();
    expect(api.submitted).toEqual([]);
  });

  it('submits the text with a trimmed title and role, then exposes the new document', async () => {
    const { api, vm } = setup();
    const documentId = newId<DocumentId>();
    api.submitResult = { ok: true, value: { documentId, runId: newId<RunId>() } };

    vm.setTitle('  Opposition  ');
    vm.setRole('opposing_brief');
    vm.setText('An argument.');
    await vm.submit();

    expect(api.submitted).toEqual([
      { sourceText: 'An argument.', title: 'Opposition', role: 'opposing_brief' },
    ]);
    expect(vm.submittedDocumentId).toBe(documentId);
    expect(vm.submitting).toBe(false);
  });

  it('omits an empty title and an unset role', async () => {
    const { api, vm } = setup();
    api.submitResult = { ok: true, value: { documentId: newId(), runId: newId() } };
    vm.setRole('not-a-role');
    vm.setText('An argument.');
    await vm.submit();

    expect(api.submitted).toEqual([{ sourceText: 'An argument.' }]);
  });

  it("shows the server's message when the submission is rejected", async () => {
    const { api, vm } = setup();
    api.submitResult = failure('document_too_large', 'The text is too long.');
    vm.setText('An argument.');

    await vm.submit();

    expect(vm.submitError).toBe('The text is too long.');
    expect(vm.submittedDocumentId).toBeNull();
    vm.setText('A shorter argument.');
    expect(vm.submitError).toBeNull();
  });

  it('lists earlier documents', async () => {
    const { api, vm } = setup();
    api.documents = {
      ok: true,
      value: [
        {
          id: newId<DocumentId>(),
          title: 'Brief',
          role: 'own_brief',
          created_at: new Date(),
          latest_run_status: 'completed',
        },
      ],
    };

    await vm.loadDocuments();

    expect(vm.documentsLoaded).toBe(true);
    expect(vm.documents.map((d) => d.title)).toEqual(['Brief']);
  });

  it('reports a list that cannot be loaded', async () => {
    const { api, vm } = setup();
    api.documents = failure('network', 'The server could not be reached.');
    await vm.loadDocuments();
    expect(vm.documentsError).toBe('The server could not be reached.');
  });
});
