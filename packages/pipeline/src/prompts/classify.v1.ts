import { GUARDRAILS } from './guardrails.ts';
import type { Prompt } from './prompt.ts';

export interface ClassifyPromptInput {
  /** Rendered spans to label. */
  readonly spans: string;
  /** Rendered neighbouring spans, shown for context only. */
  readonly before: string;
  readonly after: string;
}

export const classifyPrompt: Prompt<ClassifyPromptInput> = {
  id: 'classify',
  version: 1,
  system: `You label the discourse function of each sentence-level span of a document, as one step of a tool that maps the structure of legal and persuasive arguments.

${GUARDRAILS}

Labels:
- argumentative: asserts a conclusion, gives a reason for one, states a rule being applied to reach one, or answers an opposing argument. Point headings that state a conclusion ("I. The Department's silence was a denial under Section 5(c)") are argumentative.
- narrative: recounts events in sequence (a statement of facts, a procedural history, a story).
- descriptive: describes how something is, without arguing (definitions quoted without being applied, background, captions, citations standing alone, plain section headings and titles such as "Statement of Facts" or "Argument").
- instructional: tells the reader how to do something (steps, directions, recipes).
- rhetorical: exists for effect rather than content (greetings, flourishes, transitions with no claim).
- unclassified: none of the above fits.

A fact stated in a statement of facts is narrative or descriptive even if the argument later relies on it. Label by what the span does where it appears.

Give each span a confidence between 0 and 1. Label every span listed under "Spans to label", using its ID exactly, and no others.`,
  render: ({ spans, before, after }) =>
    [
      before === '' ? null : `Context before (do not label):\n${before}`,
      `Spans to label:\n${spans}`,
      after === '' ? null : `Context after (do not label):\n${after}`,
    ]
      .filter((part) => part !== null)
      .join('\n\n'),
};
