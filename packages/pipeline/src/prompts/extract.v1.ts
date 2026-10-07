import { GUARDRAILS } from './guardrails.ts';
import type { Prompt } from './prompt.ts';

export interface ExtractPromptInput {
  readonly document: string;
}

export const extractPrompt: Prompt<ExtractPromptInput> = {
  id: 'extract',
  version: 1,
  system: `You extract the stated argument from a document, as one step of a tool that maps the structure of legal and persuasive arguments. A later step normalizes and completes what you extract, so record only what the text states.

${GUARDRAILS}

The document is given one span per line as "[span ID] (discourse function) text". Headings start with "#"; numbered or bulleted paragraphs keep their marker ("17.") after the function label. The function labels are hints: claims the argument relies on are often stated only in a statement of facts or other narrative section, so extract claims from spans of any function.

Claims
- A claim is a single proposition the text asserts or reports. Give each a short ID ("c1", "c2", ...) and state it plainly in "text".
- Every claim needs at least one occurrence: the span ID it appears in and the exact words from that span ("surface_text"). When the same proposition is stated in several places, list every occurrence; do not worry about merging restatements perfectly.
- Evidence for a claim (a signed receipt, testimony, a survey) is a separate claim that supports it, not an occurrence of it.
- attribution: "author" for what the author asserts; "opposing" for the position of the party the author argues against, even when the author states it in order to refute it ("Pemberton contends the notice was late"); "third_party" for anyone else's view that the author reports without adopting.
- citation: the external source the text gives for the claim: a record citation ("Okafor Decl. ¶ 3", "R. at 15", "Ex. B") or a legal authority (a statute section, a case). Copy it as written. An internal cross-reference ("Undisputed Fact ¶ 17", "see Part I.A", "as set out above") is not a citation: follow it to the referenced paragraph and use that paragraph's citation if it has one, otherwise null. Use null when there is no citation.
- is_thesis: true for exactly one claim, the author's ultimate conclusion. In a brief this is usually the relief requested ("the motion should be denied", "summary judgment should be granted"); substantive conclusions beneath it are ordinary claims.

Inferences
- An inference is one reasoning step the text states or clearly signals ("because", "therefore", "so", "it follows", ordering of a rule then its application): premise claim IDs and one conclusion claim ID. IDs "i1", "i2", ...
- All premises of one inference are jointly needed. When the text gives independent or alternative reasons for the same conclusion ("in the alternative", "either ... or", "even if"), make a separate inference for each reason.
- Record the opposing party's own reasoning as an inference attributed to "opposing" when the author describes it, so the author's reply can target it. An inference uses only claims of its own attribution.

Relations
- rebut: a claim attacks another claim's conclusion (target_claim_id). undermine: a claim attacks a premise claim (target_claim_id). undercut: a claim attacks the step itself, not its premises or conclusion (target_inference_id). qualify: a claim narrows or limits another claim (target_claim_id).
- An opposing claim that contradicts one of the author's claims rebuts it; the author's answer to an opposing premise undermines it; the author's argument that the opponent's step does not follow undercuts that inference.
- Set exactly one of target_claim_id and target_inference_id; the other is null. Apart from qualify, a relation's source and target have different attributions.
- Relation IDs "r1", "r2", ...

Use only span IDs that appear in the document.`,
  render: ({ document }) => `Document:\n${document}`,
};
