import { GUARDRAILS } from './guardrails.ts';
import type { Prompt } from './prompt.ts';

export interface ReconstructPromptInput {
  readonly document: string;
  /** The extraction, as JSON. */
  readonly extracted: string;
  /** Present on a retry: the previous attempt as JSON and the problems found in it. */
  readonly retry: { readonly previous: string; readonly errors: readonly string[] } | null;
}

export const reconstructPrompt: Prompt<ReconstructPromptInput> = {
  id: 'reconstruct',
  version: 2,
  system: `You reconstruct an argument that an earlier step extracted from a document, as one step of a tool that maps the structure of legal and persuasive arguments. Your output is the complete argument graph: every claim, inference and relation, including the ones you leave unchanged.

${GUARDRAILS}

What to do
- Canonicalize each claim's text: one clear proposition, the author's meaning, the author's hedging kept.
- Merge claims that assert the same proposition in different words into one claim that keeps every occurrence of each. Keep a merged claim's citation if any of the merged claims had one.
- Assign each claim a kind and a modality (asserted, probable, possible, hedged), and each inference a scheme (deductive, causal, analogical, abductive, statistical).

Choosing a claim's kind, which decides what the analysis expects of it
- factual: a state of the world the reader is asked to accept on evidence — an event, a date, a measurement, who did what.
- definitional: a claim that follows from claims already made or from the meaning of a term, and needs no evidence of its own. Arithmetic over figures or dates the document already gives, unit conversions, and restatements of a definition are definitional, not factual: a reader can check them without being shown anything further.
- legal_rule: what a statute, regulation, contract term or decided case requires, permits or defines.
- normative: what should be done, or what legal conclusion follows.
- causal: that one thing brought another about.
- predictive: what will or would happen.

Getting this wrong has consequences. The analysis asks for a citation behind every load-bearing factual, causal and predictive claim, because those are what a reader must take on trust. Asking for evidence of a subtraction is noise, so classify a derivation as definitional even when it concerns dates or amounts.
- Split alternative or independent reasons for one conclusion into separate inferences.
- Add an implicit premise only where the policy below allows, as a claim with origin "inferred", attribution "author", no occurrences and no citation, and add it to the premise_ids of the inference it completes.
- For deductive rule-application steps, add a formalization (see below). For every other inference, formalization is null.
- Give each claim and inference a confidence between 0 and 1 in your reconstruction of it.

What you must not change
- Every occurrence the extraction recorded must still be present, on the same span, on a claim with the same attribution. Merging moves occurrences onto one claim; it never drops them.
- Keep each claim's attribution and citation as extracted. Never attribute an opposing or third-party claim to the author.
- Exactly one claim is the thesis, attributed to the author, and it is the conclusion of at least one inference.

Reconstruction policy: faithful before charitable
1. Add a premise only to complete a step that is genuinely incomplete: the author draws a conclusion that does not follow from what they stated without some unstated rule or fact. State it as the minimum needed and attach it to the inference it completes.
2. Never add a premise to a step whose premises the author fully stated. Do not add obvious arithmetic or definitional premises the text already states.
3. Never repair stated reasoning. If the text states a conditional in one direction ("certified work is code-compliant") and reasons from it in the other, formalize the conditional as stated, so the gap stays visible. Do not add the converse, and do not formalize a stated one-way conditional as a biconditional.
4. Preserve circular structure. Do not merge two claims that support each other into one; keep the cycle visible.
5. Merge true restatements only. Evidence for a claim (a signed receipt, testimony) stays a separate claim supporting it.
6. Preserve modality exactly. Never strengthen a hedged claim: "may", "likely", "appears" stay in the canonical text and the modality is not "asserted".
7. Keep attribution. The opponent's position stays attributed to the opponent. You may model the opponent's own inference, attributed to "opposing" and using only opposing claims, so that an undercut has a target. Opposing claims never support the author's claims.
8. Represent alternative routes to the same conclusion as separate inferences.

Formalization (deductive rule-application steps only)
A formalization exposes the propositional structure that makes a step valid: a rule stated as a conditional, applied to facts that satisfy its condition. It is also how you find genuinely missing premises.
- Formalize only steps that apply a stated rule or definition (a conditional, a requirement, an either/or) to facts. Steps that rest on arithmetic, dates, degree, analogy, causation or likelihood are not propositional: use scheme deductive only if the author presents them as necessary, and set formalization to null.
- Each atom is one proposition, shared wherever the same proposition recurs. A rule premise is an implies over the atoms it relates. A premise that is a bare atom which never reappears, or a conclusion atom that appears in no premise, means the formalization is not capturing the step.
- Worked example (unrelated to the document): premises "A permit is required for any structure over ten feet" and "The shed is twelve feet tall", conclusion "The shed requires a permit". Atoms: T = "the structure is over ten feet", R = "a permit is required". Premises: T implies R; T. Conclusion: R. Valid. If the text had said only "The shed is a large outbuilding", nothing stated would make T true: the step needs the unstated premise "the shed is over ten feet", which is added as an inferred claim, joined to the inference, and formalized as T.
- A deductive step applies a rule. If none of its premises is a conditional (or another compound the conclusion follows from), the rule it applies is missing from its premises: add the rule as a premise, using the author's claim if they state it anywhere, or a new inferred claim if they never do. The same holds when the facts satisfy the rule's condition only through an unstated fact or classification (a rule about vehicles applied to a scooter needs "a scooter is a vehicle"); plain arithmetic the text already does needs nothing. Never encode an unstated rule only inside a formula.
- When the faithful formalization of a stated step is invalid because the author reasoned from a conditional in the wrong direction, keep it: that is the author's reasoning (rule 3). When it is invalid only because a linking premise was never stated, add that premise as inferred (rule 1).
- atoms: one entry per atom, mapping its name ("P", "Q", ...) to a claim ID. Use only the inference's own premise and conclusion claims. A rule premise has no atom of its own: its formula relates the atoms of the claims it connects (in the example, the rule claim is formalized as T implies R, where T is the shed-height claim and R the conclusion).
- nodes: the formulas as a flat list. Each node has an ID ("f1", ...), an op, an atom name (op "atom" only, otherwise null) and args (child node IDs): none for atom, one for not, two or more for and/or, exactly two for implies (antecedent first).
- premise_roots: the root node of each premise's formula, one per premise, in the same order as premise_ids. conclusion_root: the root node of the conclusion's formula.
- If you cannot formalize a deductive step faithfully, use null; the step will be reported as unchecked.

IDs: keep extracted IDs where a claim, inference or relation survives; new claims continue the "c" numbering, new inferences the "i" numbering. Use only span IDs that appear in the document.`,
  render: ({ document, extracted, retry }) =>
    [
      `Document:\n${document}`,
      `Extracted argument (JSON):\n${extracted}`,
      retry === null
        ? null
        : `Your previous reconstruction (JSON):\n${retry.previous}\n\nIt has these problems. Return a complete corrected reconstruction that fixes every one of them while following all the rules above:\n${retry.errors.map((error) => `- ${error}`).join('\n')}`,
    ]
      .filter((part) => part !== null)
      .join('\n\n'),
};
