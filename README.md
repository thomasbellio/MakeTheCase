# Make Your Case

**See the structure behind any argument, and find out exactly what it depends on.**

Make Your Case is a tool that reads a piece of persuasive writing, such as a legal brief, an essay, or an opinion article, and breaks it down into its building blocks: the main point being argued, the reasons offered in support of it, and the assumptions it quietly relies on. It then shows you, clearly and visually, how those pieces fit together and which of them the whole argument hinges on.

---

## The problem

Most arguments arrive as paragraphs of prose. That's how people naturally write and persuade, but it makes reasoning hard to inspect. A conclusion can sound convincing while resting on a claim that was never actually stated, never supported, or only assumed. Spotting those weak points usually takes a trained eye, careful rereading, and a lot of time.

Lawyers do this work constantly, reviewing their own briefs before filing and dissecting the other side's arguments in response. Students, journalists, researchers, and curious readers do a version of it whenever they ask, "Wait, does this actually follow?"

Make Your Case is meant to make that process faster, clearer, and more thorough.

## What it does

You give Make Your Case a piece of writing. It then:

1. **Figures out whether the text is making an argument at all.** A story, a news report, or a set of instructions isn't trying to prove a point. Many real documents mix narrative and argument, so the tool identifies which parts are doing the arguing.

2. **Identifies the main point and the reasons behind it.** It separates the central claim (the thesis) from the supporting points, and maps out which reasons support which conclusions.

3. **Surfaces the unstated assumptions.** Arguments almost always skip steps that seem obvious to the author. The tool fills in those missing links and clearly labels them as assumptions, not as things the author said.

4. **Shows what the argument depends on.** Some claims are load-bearing: if they turn out to be false, the argument falls apart. Others are helpful but not essential. Make Your Case tells you which is which.

5. **Lets you see and explore the result.** The argument is displayed as a map you can navigate, and every piece links back to the exact sentence it came from in the original text.

## A quick example

Imagine a brief that says:

> "The contract requires written notice within 30 days of a breach. The plaintiff emailed the defendant on day 28. Notice was therefore timely."

Make Your Case would identify the conclusion (*notice was timely*), the two stated reasons (*the 30-day requirement* and *the day-28 email*), and one important assumption the writer never stated:

> *An email counts as "written notice" under this contract.*

It would then point out that the whole argument depends on that assumption. If the contract requires notice by certified mail, the argument fails, no matter how solid the other facts are. That's exactly the kind of weak point a careful reviewer, or opposing counsel, would want to find.

## Who it's for

**Legal professionals** are the primary audience. Make Your Case can help an attorney review a brief before filing, stress-test their reasoning, or quickly understand the structure and pressure points of an opponent's argument.

**Everyone else** can benefit too. Students learning to write and evaluate arguments, journalists and researchers checking the reasoning in what they read, and anyone who wants to look past persuasive language to see what's really being claimed.

## What it is not

- **It is not a judge.** Make Your Case is a supporting tool. It highlights structure and weak points to inform human judgment; it doesn't replace it, and it doesn't hand down verdicts.
- **It doesn't decide who did what.** The tool analyzes claims and the reasoning that connects them. It does not draw conclusions about whether any real person is guilty, responsible, or at fault.
- **It isn't a "gotcha" machine.** Rather than slapping labels on writing, it explains what an argument relies on and raises questions worth asking, so readers can draw their own conclusions.
- **It doesn't decide what's true.** Identifying that an argument depends on a claim is different from deciding whether that claim is correct. That's the job of evidence and human judgment.

## Guiding principles

- **Transparency.** Every element the tool identifies points back to the original text. Anything the tool inferred on its own is clearly marked as such.
- **People stay in charge.** Users can review, correct, and refine the breakdown, and the analysis updates to reflect their changes.
- **Structure over spin.** The goal is to show how an argument is built, not to judge whether its author is right or wrong.
- **Confidentiality matters.** Legal documents often contain sensitive information, and the product is being designed with that in mind from the start.

## Looking ahead

Future versions are planned to let users attach evidence to the specific claims an argument depends on, and to compare competing explanations side by side, for example, the cases presented by two opposing parties, using the same set of facts.

## Project status

Make Your Case is in the early design stage. The current focus is defining how arguments are represented and how the core analysis will work. Expect things to change as the project develops.

## Local development

The repository is a pnpm + Turborepo monorepo. The scaffolding is in place and the
argument analysis itself is not built yet, so the app currently serves a
placeholder page.

**Prerequisites:** Node 24 or newer (the repo pins 26 in `.nvmrc`), pnpm, and
Docker for the local Postgres.

```bash
pnpm install
cp .env.example .env     # defaults match the Postgres in docker-compose.yml
pnpm db:up               # start Postgres
pnpm db:migrate          # create the schema (once, and after any schema change)
pnpm dev                 # http://localhost:3000
```

Checks, all of which should pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm lint:boundaries     # asserts the architecture rules reject illegal imports
pnpm format:check
```

`pnpm db:down` stops Postgres.

`pnpm eval` measures the analysis pipeline against the answer keys in
`fixtures/arguments/` and writes a report to `eval-results/`. It calls real
language models, so it costs money and is never part of `pnpm test`; add
`--no-judge` to skip the grading model, or `--fixture 05` to run just one.

See `AGENTS.md` for the architecture, the dependency rules between packages, and
the phased implementation plan.
