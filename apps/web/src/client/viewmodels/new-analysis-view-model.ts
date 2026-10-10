import { makeAutoObservable, runInAction } from 'mobx';
import {
  documentRoleSchema,
  type DocumentId,
  type DocumentRole,
  type DocumentSummary,
} from '@make-your-case/domain';
import type { ApiClient } from '../api/api-client.ts';

export interface NewAnalysisOptions {
  readonly maxDocumentChars: number;
}

export const ROLE_OPTIONS: readonly { readonly value: DocumentRole; readonly label: string }[] = [
  { value: 'own_brief', label: 'My brief' },
  { value: 'opposing_brief', label: "Opposing party's brief" },
  { value: 'article', label: 'Article or opinion piece' },
  { value: 'other', label: 'Other' },
];

/**
 * The new-analysis screen (AGENTS.md section 9.2): the submission form and
 * the list of earlier documents.
 */
export class NewAnalysisViewModel {
  title = '';
  role: DocumentRole | null = null;
  text = '';

  submitting = false;
  submitError: string | null = null;
  /** Set once a submission succeeds; the View navigates to the document. */
  submittedDocumentId: DocumentId | null = null;

  documents: readonly DocumentSummary[] = [];
  documentsLoaded = false;
  documentsError: string | null = null;

  readonly maxDocumentChars: number;
  private readonly api: ApiClient;

  constructor(api: ApiClient, options: NewAnalysisOptions) {
    this.api = api;
    this.maxDocumentChars = options.maxDocumentChars;
    makeAutoObservable<this, 'api'>(
      this,
      { api: false, maxDocumentChars: false },
      { autoBind: true },
    );
  }

  get charCount(): number {
    return this.text.length;
  }

  get tooLarge(): boolean {
    return this.charCount > this.maxDocumentChars;
  }

  get isBlank(): boolean {
    return this.text.trim().length === 0;
  }

  get canSubmit(): boolean {
    return !this.submitting && !this.isBlank && !this.tooLarge;
  }

  /** Shown under the textarea, before the user tries to submit. */
  get sizeMessage(): string | null {
    if (!this.tooLarge) return null;
    return (
      `The text is ${this.charCount.toLocaleString('en-US')} characters long; ` +
      `the limit is ${this.maxDocumentChars.toLocaleString('en-US')}. Shorten it to submit.`
    );
  }

  setTitle(value: string): void {
    this.title = value;
  }

  setRole(value: string | null): void {
    const parsed = documentRoleSchema.safeParse(value);
    this.role = parsed.success ? parsed.data : null;
  }

  setText(value: string): void {
    this.text = value;
    this.submitError = null;
  }

  async submit(): Promise<void> {
    if (!this.canSubmit) return;
    this.submitting = true;
    this.submitError = null;

    const title = this.title.trim();
    const result = await this.api.submitDocument({
      sourceText: this.text,
      ...(title === '' ? {} : { title }),
      ...(this.role === null ? {} : { role: this.role }),
    });

    runInAction(() => {
      this.submitting = false;
      if (result.ok) {
        this.submittedDocumentId = result.value.documentId;
      } else {
        this.submitError = result.error.message;
      }
    });
  }

  async loadDocuments(): Promise<void> {
    const result = await this.api.listDocuments();
    runInAction(() => {
      this.documentsLoaded = true;
      if (result.ok) {
        this.documents = result.value;
        this.documentsError = null;
      } else {
        this.documentsError = result.error.message;
      }
    });
  }
}
