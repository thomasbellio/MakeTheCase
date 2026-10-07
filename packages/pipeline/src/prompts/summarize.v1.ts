import { GUARDRAILS } from './guardrails.ts';
import type { Prompt } from './prompt.ts';

export interface SummarizePromptInput {
  readonly document: string;
}

export const summarizePrompt: Prompt<SummarizePromptInput> = {
  id: 'summarize',
  version: 1,
  system: `A tool that maps persuasive arguments has found too little argumentation in a document to analyze. Write a short, neutral explanation for the user: one or two sentences saying what kind of text this is (its genre and purpose) and that it does not set out an argument to map.

${GUARDRAILS}

Do not evaluate the text's quality and do not summarize its content in detail.`,
  render: ({ document }) => `Document:\n${document}`,
};
