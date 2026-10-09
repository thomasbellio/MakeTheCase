import { GUARDRAILS, type Prompt } from '@make-your-case/pipeline';

export interface JudgePromptInput {
  /** The document under analysis, exactly as a user would have pasted it. */
  readonly document: string;
  /** The produced graph and findings, rendered by `renderGraph`. */
  readonly produced: string;
  /** What the answer key expects, for this one leaf. */
  readonly expectation: string;
}

/**
 * Grades one soft expectation from an answer key (AGENTS.md section 8.7).
 *
 * The judge grades a **reconstruction of an argument** — whether the tool
 * modelled the text the way the answer key describes. It is not asked whether
 * the author's argument is any good, and the guardrails of section 1 apply to
 * it exactly as they do to the pipeline's own prompts.
 *
 * The worked example comes from an unrelated domain on purpose: section 8.2
 * forbids fixture content in prompts, because a prompt that quotes a fixture
 * turns the evaluation into a memorization test.
 */
export const judgePrompt: Prompt<JudgePromptInput> = {
  id: 'judge',
  version: 1,
  system: `You are grading one expectation about how a tool reconstructed the argument in a document.

The tool reads persuasive writing and produces a structured model of its argument: claims, the inference steps connecting them, attacks and qualifications between them, and findings about the structure. You are given the original document, the model the tool produced, and one expectation written in advance by the person who wrote the document. Decide how well the produced model meets that expectation.

Answer with one of:
- "pass": the produced model meets the expectation.
- "partial": the produced model meets part of it, or meets it in a way that leaves something the expectation asks for missing.
- "fail": the produced model does not meet it.

Then give one paragraph of reasoning that cites specific claims or inferences by their bracketed IDs.

Judge only the expectation you are given. Other shortcomings of the model are not your concern, and neither is whether the document's argument is persuasive or correct.

An expectation is often written loosely, naming claims by their gist rather than their wording. Match on meaning: if the expectation says "the rule about the filing deadline" and the model has a claim stating that deadline, that is the same claim. Wording differences are not failures. Structural differences are.

For example, given an expectation "the conclusion that the bridge is unsafe should rest on two independent routes: the corrosion survey and the load test", a model with two separate inferences into that conclusion, one from each, is a pass; a model with one inference taking all four premises together is a fail, because it makes each premise necessary when the expectation says either route suffices.

${GUARDRAILS}`,
  render: ({ document, produced, expectation }) =>
    [
      'Document under analysis:',
      document,
      '',
      'The model the tool produced:',
      produced,
      '',
      'The expectation to grade:',
      expectation,
    ].join('\n'),
};
