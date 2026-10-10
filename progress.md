# Progress

A status snapshot, last updated **2026-10-10**.

`AGENTS.md` is the specification and the authority on every decision; this file only records where
the work has got to. If the two disagree, `AGENTS.md` is right and this file is stale.

## Where things stand

| Phase | State |
|---|---|
| **Phase 1** — domain model, analysis engine, persistence (§7) | Complete |
| **Phase 2** — LLM integration (§8) | Complete except prompt quality (§8.8), which needs a billed sweep. |
| **Phase 3** — UI (§9) | Built; automated criteria pass. The manual fixture sweep (§9.4) is the maintainer's. |

Unit tests: 431 pass (`pnpm test`), plus 15 integration tests (`pnpm test:db`). Analysis coverage
was 98.6% statements at the last measurement, against §7.5's 90% bar.

| Workspace | Tests |
|---|---|
| `apps/web` | 123 |
| `packages/analysis` | 103 |
| `packages/pipeline` | 95 |
| `packages/answer-keys` | 37 |
| `packages/domain` | 22 |
| `apps/worker` | 19 |
| `tools/eval` | 18 |
| `packages/persistence` | 14 (+13 integration) |

## What is implemented

**Scaffolding (§7.1).** pnpm + Turborepo across nine workspaces, Postgres 18 in Compose, shared
tsconfig/eslint/vitest presets, and import boundaries that are themselves tested — seven
`__boundaries__` fixtures that `pnpm lint:boundaries` requires ESLint to reject.

**`packages/domain` (§7.2).** Zod schemas and types for every entity in §6, branded IDs, the
`ArgumentGraph`/`ArgumentGraphDraft` pair, the type-only `ArgumentGraphView<Id>` the analysis layer
consumes, repository interfaces, local-ID → UUID materialisation, config parsing, the queue
contract, and in-memory repository fakes at `@make-your-case/domain/testing`.

**`packages/analysis` (§7.3).** `validateArgumentGraph` with every §7.3 rule, and
`analyzeArgumentGraph` composing six analyzers over a shared support model. Support is a least fixed
point, so an argument gets no credit for assuming its own conclusion; load-bearing seeds cycle
members so the answer stays meaningful on a circular graph. Propositional entailment is checked by an
in-house checker, not `logic-solver` (unmaintained since 2016).

**`packages/persistence` (§7.4).** Drizzle schema mirroring `docs/argument-model.mermaid`, committed
migrations, mappers, all four repositories including the transactional and idempotent
`saveAnalysisResult`, and `createRepositories(db)` for the composition roots.

**`packages/pipeline` (§8.1, §8.2).** Provider abstraction with per-stage resolution, wire schemas
separate from domain schemas, all five stages, versioned prompts, the compiled LangGraph workflow
with resume-from-checkpoint, the Postgres checkpointer, and `FakeModelProvider` /
`RecordingProgressReporter` / `createMemoryCheckpointer` for tests.

**`apps/worker` (§8.4, §8.5).** pg-boss consumer, composition root, the database-backed
`ProgressReporter` that writes `RunEvent` rows, the run lifecycle (status, timestamps,
`model_config`), redelivery that does nothing when a run already finished, and graceful shutdown.
Verified end to end against real Postgres with no model calls: a job was enqueued, delivered,
short-circuited and marked complete, and `SIGTERM` shut the worker down cleanly.

**`packages/answer-keys` + `tools/eval` (§8.7).** The answer-key schema, loader and deterministic
hard-check scorer — shared with `packages/analysis`'s acceptance test, so the hard keys have one
implementation — plus the judge, the `pnpm eval` CLI and the report. `--repeat N` reports pass rates,
because the pipeline is non-deterministic enough that a single run cannot tell an improvement from
variance.

**The API (§8.6) and the UI (§9)** — see AGENTS.md §8.6 and §9.4 for the decisions. Wire contracts
in `domain/src/contracts`, a pool-safe composition root, six thin routes, an SSE stream with
`Last-Event-ID`/`?after=` resume, the MVVM client, and a `seed:demo` script for looking at the UI
with no model call. Verified against Postgres (curl, including a live SSE stream and resume) and by
rendering both a seeded and a real eval-produced revision in headless Chromium, in light and dark.

Bugs found and fixed on the way: `DocumentRepository.list` never reported a run status (its
correlated subquery compared `r.document_id` with `r.id`); and two boundaries misconfigurations had
silently exempted most `apps/web` imports from the import rules (AGENTS.md §3).

Found afterwards, under `pnpm dev`: the document page stayed on its loading skeleton. Strict Mode
mounts, cleans up and mounts again with the same ViewModel, and its one-shot `dispose` flag made the
second load discard its response. The headless check had run against `next start`, where effects run
once. Lifecycle is now per activation (AGENTS.md §9.1), with a `<StrictMode>` screen test.

## What is left

### 1. ~~The API (§8.6)~~ — done; notes kept for history

Six route handlers (`POST /api/documents`, `GET /api/documents`, `GET /api/documents/:id`,
`GET /api/documents/:id/argument`, `GET /api/runs/:id`, `GET /api/runs/:id/events`), and everything
they need, none of which exists:

- `apps/web/src/server/` — the composition root. It must own the connection pool **across Next's
  module reloads**, which is the one genuinely awkward part: `createDb` deliberately has no
  module-level singleton, and a dev-mode reload must not leak pools.
- The request/response schema module. §8.6 hedges ("or a `contracts` module within it") and it does
  not exist. Entity schemas use `z.date()`, so wire serialisation needs deciding.
- The SSE stream over `AnalysisRunRepository.listEventsSince`, with `Last-Event-ID` resume, closing
  on terminal status. Polling at ≈500 ms is explicitly acceptable in v1.
- The enqueue side, which now has a contract to call: `ANALYZE_DOCUMENT_QUEUE` and
  `analyzeDocumentJobSchema` from `domain`. Remember `boss.createQueue()` before `send()`.
- `MAX_DOCUMENT_CHARS` is parsed but enforced nowhere; §8.2 says reject at submission.
- Add `// TODO(security): unauthenticated in v1` to each handler (§2).

**Boundary constraint worth knowing before starting:** a route handler lives in `web-app`, which may
**not** import `persistence`, `pg-boss` or `zod` directly. Only `web-server` may. So handlers must
stay thin and delegate — which is what §2 wants anyway, so auth middleware can be added in one place
later. There is no boundary fixture for the web-app → persistence rule yet; add one.

### 2. Prompt quality (§8.8) — blocked on a manual sweep

The only thing gating Phase 2's acceptance criteria. Per §12 an agent must not run anything billed,
so this needs a human sweep to characterise. Current baseline: fixture 01 at **0/5** attempts, on
`claude-haiku-4-5`.

- **Formalizations do not entail their conclusions.** Fired `invalid_step` on fixture 01 — whose
  whole point is a *valid* rule application — in both attempts that completed. Prompt semantics.
- **Structured-output reliability: addressed, unmeasured.** Two causes were found by reading the
  code (the repair handled two of seven damage shapes; a retry repeated the identical request) and
  both are fixed with deterministic tests. Whether the error rate actually fell needs a sweep.
- **`reconstruct@2` is unproven.** Guidance for choosing a claim's `kind` was added because the
  analyzer was demanding a citation for date arithmetic. Sample too small to separate from variance.

### 3. Phase 3 — the manual sweep (§9.4)

Run the worker against a real model, submit each fixture, and check live progress, span ↔ claim
highlighting, inferred marking and the opposing group; fixtures 11 and 12 should show the
non-argument summary. Billed, so the maintainer's. Things worth watching:

- A real eval revision for fixture 05 put an intermediate conclusion above the thesis on the map — the
  model chose a sub-conclusion as `is_thesis`. A pipeline signal for §8.8, not a UI defect.
- Wide arguments lay out wide (the ground layer spreads horizontally), so fit-to-view zooms out.
  Readable, but a candidate for tuning ELK spacing once real briefs are on screen.
- Node heights are estimated from text length, not measured; an unusually long word could overflow.

### 4. Smaller items

- Fixtures 01 and 02 carry the dead `linked`/`convergent` vocabulary in their filenames and notes.
  `id` must match the file stem, so renaming is a coordinated change.
- `getArgumentGraph` orders rows by UUID, so a saved graph comes back in a different order on every
  read. The UI now sorts into reading order itself, so the map is stable; diffing revisions would
  still want an ordinal column.
- `inference_premise` has no ordinal, so premise order is not actually persisted — despite a
  `toView` comment in `domain` claiming it is. Nothing depends on it today because
  `deductive-validity` pairs through `formalization.atoms`, but the comment invites a future analyzer
  to rely on a guarantee the database does not make.
- §13 lists what is deliberately out of scope, plus three analysis ideas and three fixture gaps.

## Open questions

1. **Does the judge belong in the Phase 2 gate at all?** §8.8's target names `expected_status` and
   hard checks only, and the CLI's exit code ignores soft grades deliberately — a judge is not a
   gate. Worth confirming that is the intent before the first full sweep.
2. **`findings_present` with a severity is read existentially** — "at least one finding of that kind
   has it". The strict reading would catch an *extra*, more severe finding of the same kind, which is
   the over-reconstruction fixture 14 guards against. One-line change; the fixtures do not currently
   distinguish.
3. **No fixture exercises `third_party` attribution.** The enum value is modelled, validated and
   rendered, but nothing tests it.
4. **Will the open §8.8 issues survive a better model?** §12 says not to design around them. If a
   stronger model makes them disappear, `reconstruct@2` and the `--repeat` machinery should be
   re-judged on that basis rather than kept because they exist.
5. **How much does the API need before the UI is worth starting?** The six endpoints are
   independent; the document page needs `GET /api/documents/:id`, `/argument` and `/events`, so the
   UI could begin before `POST` and the list endpoint are polished.

## Running it

```bash
pnpm install
cp .env.example .env
pnpm db:up && pnpm db:migrate     # migrations are explicit; a fresh clone has an empty database
pnpm dev                          # http://localhost:3000
pnpm --filter @make-your-case/web seed:demo   # a demo analysis, no model call
```

Gates, all of which currently pass:

```bash
pnpm lint          # covers test/ as well as src/
pnpm typecheck
pnpm test          # unit only; needs no Docker
pnpm test:db       # repository + checkpointer integration; needs pnpm db:up
pnpm build
pnpm lint:boundaries
pnpm format:check
```

`pnpm eval` is billed and **not** for agents to run (§12). `--no-judge` skips the grading model,
`--fixture 05` runs one, `--repeat 5` measures a rate.
