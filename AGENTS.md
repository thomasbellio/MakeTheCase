# CLAUDE.md — Make Your Case

This file is the implementation context for coding agents working in this repository. Read it fully before making changes. `README.md` explains the product for a general audience; this file explains how to build it.

---

## 1. What we are building

Make Your Case takes a piece of persuasive writing (pasted Markdown) and produces a structured, inspectable model of its argument:

1. Decide whether the text (or which parts of it) is argumentative at all.
2. Extract the thesis, the claims that support it, and the inference steps connecting them.
3. Reconstruct the argument: normalize claims, merge duplicates, and surface **implicit premises** the author relied on but never stated.
4. Analyze the structure deterministically: find load-bearing claims, circular reasoning, unsupported claims, and invalid or unchecked deductive steps.
5. Display the result as an interactive, read-only argument map linked back to the source text.

The primary audience is legal professionals. The tool is **supplementary, never dispositive**.

### Product guardrails (apply to all code, prompts, and UI copy)

- The system analyzes **propositions and the reasoning connecting them**. It never produces verdicts about people (guilt, fault, liability, intent). Prompts must instruct models accordingly, and no schema field, finding kind, or UI element may express such a verdict.
- Anything the system **inferred** (claims, premises, inferences) must be marked `origin: "inferred"` at every layer, persisted as such, and visually distinguished in the UI. Never present inferred content as something the author said.
- Every stated claim must trace back to one or more source spans. No stated claim without an occurrence.
- Claims the author **reports** on someone else's behalf (an opposing party's position, a third party's view) are attributed to that party, never treated as the author's own premises.
- Reconstruction is **faithful before charitable**: it completes arguments with genuinely missing premises, but never repairs reasoning the author actually stated (see §8.3).
- Findings are framed as observations and questions ("this conclusion depends on an unstated premise"), not accusations or fallacy labels.
- The analysis layer is **deterministic**. LLMs interpret language; code evaluates structure. No LLM calls inside `packages/analysis`.

---

## 2. Scope of this iteration (v1)

### In scope

- Input: pasted text, treated as Markdown. Document text is immutable once submitted.
- Full pipeline: segmentation → classification → extraction → reconstruction → validation → analysis → persistence.
- Findings: `implicit_premise`, `load_bearing`, `circularity`, `unsupported_claim`, `unconnected_claim`, and validity checking **only** for deductive rule-application steps (`invalid_step` / `unchecked_step`).
- Live progress feedback to the user while the pipeline runs.
- Read-only visualization: argument map, source text with highlights, findings list, element inspector.
- Provider-agnostic LLM integration (commercial APIs now; Bedrock or self-hosted models later).

### Out of scope (do not build)

- User accounts, authentication, authorization, RBAC, API keys, multi-tenancy.
- Editing the argument (no adding, removing, or changing claims, relations, or thesis in the UI).
- PDF, DOCX, or file upload of any kind.
- Evidence linking and evidence reliability.
- Competing-hypothesis comparison across documents.
- Deployment manifests, Dockerfiles for production, Kubernetes configuration, CI/CD. (Deployment is documented separately. Local development may use `docker-compose.yml` for Postgres only.)
- Cost or latency optimization.

### ⚠️ Security notice — must be resolved before any deployment

In v1 **all API routes are open** with no authentication, for local development and testing only. Before this application is deployed anywhere reachable by others, the following must be designed and implemented: user management, API authentication, an RBAC model, rate limiting, a data retention policy, and confirmation that each configured LLM provider's data-handling terms are acceptable for confidential legal material.

Agents must not add authentication in v1, but must:
- keep every route handler thin and delegating to services, so auth middleware can be added in one place later;
- add `// TODO(security): unauthenticated in v1` at each route handler;
- keep the security notice above intact.

---

## 3. Technology stack

| Concern | Choice |
|---|---|
| Language | TypeScript, `strict: true`, ESM. Pinned to `typescript@6`: `typescript-eslint` peers `typescript <6.1.0`, and TS 7 ships no JS API until 7.1, so TS 7 would disable type-aware linting. |
| Monorepo | pnpm workspaces (shared versions pinned in a `pnpm-workspace.yaml` catalog) + Turborepo |
| Web app | Next.js (App Router), React |
| Database | PostgreSQL |
| ORM | Drizzle ORM + drizzle-kit migrations |
| Schemas / runtime validation | Zod v4 (`z.string().url()` is deprecated in favour of `z.url()`) |
| LLM orchestration | LangGraph JS (`@langchain/langgraph`) as an explicit **workflow graph**, not a supervisor/agent pattern |
| LLM providers | LangChain chat model integrations (e.g. `@langchain/anthropic`, `@langchain/openai`, `@langchain/aws`) behind our own provider factory |
| Workflow checkpointing | `@langchain/langgraph-checkpoint-postgres` |
| Background jobs | pg-boss (Postgres-backed queue) |
| Graph algorithms | graphology + `graphology-components` (strongly-connected components, for circularity) |
| Propositional validity | In-house entailment checker, `packages/analysis/src/logic/`. `logic-solver` was the original choice but has been unmaintained since 2016. Formalizations have a handful of atoms, so enumerating all 2^n assignments is instant, needs no dependency, keeps the analysis layer pure, and yields the counterexample an `invalid_step` finding reports. Declines to check above 20 atoms. |
| Graph rendering | React Flow (`@xyflow/react`) |
| Graph layout | ELK.js (layered layout) |
| UI components | shadcn/ui + Tailwind CSS |
| UI state (MVVM) | MobX + `mobx-react-lite` |
| Testing | Vitest. `pnpm test` is unit-only and needs no Docker; `pnpm test:db` runs repository integration tests against the local Compose Postgres (§7.6) |
| Lint / format | ESLint + Prettier |

Verify current package versions at install time; do not rely on remembered APIs. Read each library's current docs before use, especially LangGraph JS and React Flow, whose APIs change between major versions.

Traps confirmed while scaffolding, each of which breaks a setup built from older knowledge:

- Turborepo's `envMode` defaults to **`strict`**: an environment variable not declared in `globalEnv` (or a task's `env`) is stripped from the task. A new variable must be added to `turbo.json` as well as `.env.example`.
- TypeScript 6 removed `baseUrl` and `moduleResolution: node`, and no longer auto-discovers `@types`. Every Node-targeted tsconfig must set `"types": ["node"]` explicitly.
- Next 16 removed `next lint` and the `eslint` config key, so `apps/web` is linted by the root flat config like every other package. Turbopack is the default for `next build`, so `next.config.ts` must not set a `webpack` option. Generated route types (`LayoutProps`, `PageProps`) come from `next typegen`, which the web `typecheck` script runs before `tsc`.
- Vitest 5 deprecated `vitest.workspace.ts` in favour of `test.projects`; mocks auto-clear between tests, and unawaited async assertions now fail rather than warn.
- Postgres 18 images expect a single volume mount at `/var/lib/postgresql`, not `/var/lib/postgresql/data`.
- `eslint-plugin-boundaries` v7 replaced `element-types`/`external` with one `boundaries/dependencies` rule using `policies` and entity selectors.
- Two boundaries traps that silently disabled the web rules until Phase 3. An element pattern like `src/server/**/*` matches by *parent folder*, so a file directly in `src/server` was classed `web-root`; the web elements therefore use `partialMatch: false` (the v7 replacement for `mode: 'full'`). And the default resolver tries `.js` only, so an extensionless import of a `.ts` file went unresolved, and an unresolved import is exempt from every rule; `import/resolver.node.extensions` now lists `.ts`/`.tsx`. Path aliases (`@/…`) are still unresolved, so web code uses relative imports.
- Next reads `.env` only from `apps/web`, so `next.config.ts` loads the root `.env` with `process.loadEnvFile`. The shared Next tsconfig sets `allowImportingTsExtensions` (legal under `noEmit`), because web compiles workspace source that uses `.ts` imports.
- MobX 7 removed `observable.ref` and friends for named exports (`observableRef`, `computedStruct`, …) and dropped legacy decorators; ViewModels use `makeAutoObservable` with an overrides map.
- React Flow has a built-in `group` node type with its own box styling; a custom node type named `group` draws a second border. The map's group type is `party`.

---

## 4. Repository layout

```
make-your-case/
├── apps/
│   ├── web/                 # Next.js: UI (MVVM) + API route handlers
│   │   └── src/
│   │       ├── app/         # App Router pages and route handlers
│   │       ├── server/      # Services, composition root for the API
│   │       ├── client/      # API client, ViewModels, Views (domain types only)
│   │       ├── components/  # shadcn/ui components
│   │       └── lib/         # `cn` helper and other UI utilities
│   └── worker/              # Node process: pg-boss consumer that runs the pipeline
├── packages/
│   ├── domain/              # Plain domain types, Zod schemas, repository interfaces. No I/O.
│   ├── analysis/            # Structural validation + deterministic logical analysis. Pure functions.
│   ├── persistence/         # Drizzle schema, migrations, data mappers, repository implementations
│   ├── pipeline/            # LangGraph workflow, LLM provider factory, prompts, stage logic
│   ├── answer-keys/         # Answer-key schema, loader and the deterministic hard-check scorer. Pure.
│   └── config/              # Shared tsconfig, eslint, vitest presets
├── tools/
│   └── eval/                # The judge, the `pnpm eval` CLI and the report
├── fixtures/
│   └── arguments/           # NN-name.md (input) + NN-name.expected.yaml (answer key)
├── docs/
│   └── argument-model.mermaid   # Canonical model (§6)
├── scripts/
│   └── check-boundaries.mjs # Asserts the dependency rules below actually reject violations
├── docker-compose.yml       # Local Postgres only
├── pnpm-workspace.yaml      # Workspace globs + shared version catalog
├── turbo.json               # Task graph; `globalEnv` must list every environment variable
├── eslint.config.js         # Root flat config for every workspace
├── .env.example
├── AGENTS.md
└── README.md
```

Fixture pairs are `fixtures/arguments/NN-name.md` (exactly what a user would paste) and
`NN-name.expected.yaml` (the answer key, §8.7). Nothing else belongs in that directory — the eval
harness globs it, and an unpaired file is an error rather than a silent skip.

`pnpm-workspace.yaml` globs `tools/*` as well as `apps/*` and `packages/*`. A new workspace must also
be added to the root `tsconfig.json` references and the root `vitest.config.ts` projects.

### Dependency rules (enforce with ESLint import boundaries)

```
domain       → (zod only)
analysis     → domain, graphology                      (no SAT dependency; see §3)
persistence  → domain, drizzle
answer-keys  → domain, zod, yaml                       (pure; shared by tools/eval and analysis's tests)
pipeline     → domain, analysis, langgraph/langchain   (NOT persistence; repositories are injected)
worker       → pipeline, persistence, analysis, domain (composition root)
web (server) → persistence, domain, pg-boss            (composition root for API)
web (client) → domain types only, via the API client
tools/eval   → pipeline, analysis, domain, persistence, answer-keys  (composition root for evaluation)
```

No package may import from an `apps/*` package. Client-side code in `apps/web` must never import `persistence`, `pipeline`, or server-only modules.

Enforced by `eslint-plugin-boundaries` in `packages/config/eslint/boundaries.js`, which matches
cross-package dependencies by module source rather than resolved path. The `web (server)` /
`web (client)` split is only expressible as a **directory** boundary, which is why
`apps/web/src/server/` and `apps/web/src/client/` are separate trees.

Lint configuration that is never exercised rots silently, so each rule has a fixture containing one
deliberately illegal import, in a `__boundaries__/` directory **inside the package it tests** (the
plugin derives an element's type from its file path). `pnpm lint:boundaries` requires every one to
be rejected. Add a fixture whenever you add a rule.

---

## 5. Architecture principles

### 5.1 Domain models are plain objects (data mapper pattern)

- Domain entities in `packages/domain` are plain, readonly TypeScript objects (types inferred from Zod schemas). No classes with behavior, no methods, no ORM decorators, no database awareness.
- Domain logic lives in pure functions (in `analysis`, or small helpers in `domain`), not on the objects.
- `packages/persistence` owns **mappers** that convert between Drizzle rows and domain objects in both directions (`toDomain`, `toRow`). Drizzle row types never leak outside `persistence`.

### 5.2 Repository pattern

- Repository **interfaces** live in `packages/domain/src/repositories/`. They speak only in domain types.
- Repository **implementations** live in `packages/persistence/src/repositories/`, using Drizzle and the mappers.
- Consumers (pipeline, worker, API services) depend on interfaces and receive implementations via constructor/function injection at the composition roots (`apps/worker`, `apps/web` server code).
- Aggregate-oriented operations are preferred. Saving a completed analysis writes a whole revision (claims, occurrences, inferences, premises, relations, findings) in **one transaction**.

Minimum interfaces:

```ts
interface DocumentRepository {
  create(input: NewDocument): Promise<Document>;
  getById(id: DocumentId): Promise<Document | null>;
  list(): Promise<DocumentSummary[]>;
}
interface SpanRepository {
  saveAll(documentId: DocumentId, spans: Span[]): Promise<void>;
  listByDocument(documentId: DocumentId): Promise<Span[]>;
}
interface RevisionRepository {
  saveArgumentGraph(graph: ArgumentGraph): Promise<RevisionId>;   // transactional
  getArgumentGraph(revisionId: RevisionId): Promise<ArgumentGraph | null>;
  getLatestForDocument(documentId: DocumentId): Promise<ArgumentGraph | null>;
}
interface AnalysisRunRepository {
  create(input: NewAnalysisRun): Promise<AnalysisRun>;
  updateStatus(id: RunId, update: RunStatusUpdate): Promise<void>;
  getById(id: RunId): Promise<AnalysisRun | null>;
  getLatestForDocument(documentId: DocumentId): Promise<AnalysisRun | null>;
  appendEvent(event: NewRunEvent): Promise<RunEvent>;
  listEventsSince(runId: RunId, afterSequence: number): Promise<RunEvent[]>;
}
```

`RevisionRepository` also has `saveAnalysisResult({ documentId, runId, spans, draft, findings })`, which is what the pipeline's `persist` node calls. In one transaction it upserts the document's spans by ordinal (keeping existing span IDs), creates the `system` revision, maps local IDs to UUIDs, writes the graph and links the revision to the run. It is idempotent per run: a run that already has a revision gets that revision back and nothing is written, so a workflow resumed after a crash between commit and checkpoint cannot save twice. `saveArgumentGraph` writes into a revision row that must already exist, because `ArgumentGraph` does not carry the document the revision belongs to.

Spans are never deleted and re-inserted on a rerun: `occurrence.span_id` cascades on delete, so doing that would destroy earlier revisions' occurrences. (`SpanRepository.saveAll` still deletes and re-inserts; nothing in the pipeline calls it.)

### 5.3 Identifiers

- Persisted IDs are UUIDs generated by application code (`crypto.randomUUID()`), never by the LLM.
- LLM stages work with short **local IDs** (`s12` for spans, `c3` for claims, `i2` for inferences). The pipeline maps local IDs to UUIDs when building the domain `ArgumentGraph`. Any local ID the model references that doesn't exist is a validation error.
- Models never produce character offsets. Spans and their offsets are computed deterministically before any LLM call; models reference span IDs only.

### 5.4 Internal packages are consumed as TypeScript source

Library packages have no build step; each exports `./src/index.ts` directly. This removes the
stale-`dist` class of bug, means `typecheck`/`lint`/`test` need no build ordering, and gives
cross-package HMR. The consequences bind every phase:

- `apps/web` must list every workspace package it imports in `transpilePackages` in
  `next.config.ts`. Adding a package dependency means editing that list, or Next will not compile it.
- Relative imports inside packages are written with a real `.ts` extension (`./ids.ts`), because
  Node needs that to execute the source directly. `allowImportingTsExtensions` and
  `rewriteRelativeImportExtensions` in the shared library tsconfig let `tsc` rewrite them to `.js`
  on emit.
- `apps/worker` is the only package with a real `build`; in development it runs its TypeScript
  entrypoint directly under Node. `pnpm eval` does too.
- **Node's type-stripping mode rejects TypeScript parameter properties** (`constructor(private readonly x: T)`),
  so nothing reachable from a bare-Node entrypoint may use them — including the repositories in
  `persistence`, which both the worker and the eval harness import. Declare the field and assign it
  in the constructor body instead. Code that only ever runs under Vitest or Next is unaffected, which
  is why this surfaces late and all at once.
- If some tool cannot resolve source, add a build for that one package rather than converting the
  repository.

---

## 6. Argument model

The canonical model is in `docs/argument-model.mermaid`. Key semantics:

- **Document**: immutable Markdown source text.
- **Span**: a sentence-level segment of the document with stable ordinal and character offsets, plus `is_heading`. Computed deterministically. Carries a discourse `function` label from classification (`argumentative`, `narrative`, `descriptive`, `instructional`, `rhetorical`, `unclassified`).
- **AnalysisRun**: one execution of the pipeline over a document. Tracks status and stage, emits **RunEvents** for progress, and stores a short genre `summary` (required when status is `not_an_argument`).
- **Revision**: a versioned snapshot of an argument graph. In v1 every successful run produces one revision with `author: "system"`. All structural entities (claims, inferences, relations, findings) belong to a revision, so reruns never collide. Editing (later) will create child revisions.
- **Claim**: a proposition. Has `canonical_text`, `kind`, `modality`, `origin`, `attribution`, optional `citation`, `confidence`, and `is_thesis`. Exactly one thesis per revision in v1: the author's ultimate conclusion (often a request for relief, e.g. "the motion should be denied"), with substantive conclusions modeled as intermediate claims beneath it.
  - **attribution** (`author | opposing | third_party`): who asserts the claim. Opposing and third-party claims enter the graph as sources or targets of relations and as parts of the opponent's own inferences; they never support the author's thesis. Inferred claims are always `author`.
  - **citation**: the external source the text offers for the claim, either a record citation ("Okafor Decl. ¶ 3", "R. at 15", "Ex. B") or a legal authority ("Lab. Code § 22", a case). Internal cross-references ("Undisputed Fact ¶ 17", "see Part I.A") are **not** citations; extraction resolves them to the referenced paragraph's citation, if it has one. Allowed on any claim kind.
  - **modality**: canonical text must preserve the author's hedging ("likely", "may", "appears"); never strengthen it.
- **Occurrence**: links a claim to a span, keeping the author's original wording (`surface_text`). Stated claims must have ≥1 occurrence; inferred claims have none.
- **Inference**: a reasoning step from one or more premise claims to one conclusion claim. Has a `scheme`, `origin`, and `attribution`. **All premises of an inference are jointly required.** Independent or alternative reasons ("in the alternative...", "any one of which is sufficient") are represented canonically as **separate inferences concluding the same claim**. There is no linked/convergent flag; this single representation removes ambiguity for extraction and simplifies analysis.
- **InferencePremise**: join between an inference and a premise claim, with its own `origin` (an inferred premise can join a stated inference).
- **Relation**: an attack or qualification. `rebut` targets a claim's conclusion, `undermine` targets a premise claim, `undercut` targets an inference, `qualify` narrows a claim. Exactly one of `target_claim_id` / `target_inference_id` is set.
- **Finding**: an analysis result referencing claims and/or inferences through **FindingTarget** rows (exactly one of `claim_id` / `inference_id` each, plus an `ordinal` giving stable order — for a circularity finding, the position round the cycle). Regenerable, never mutates structure, records `produced_by` (`analyzer-name@version`). A finding has no identity until it is persisted: the analysis layer returns findings whose targets are local IDs, and `persist` maps them.

Roles such as "premise" and "intermediate conclusion" are **computed from graph position**, not stored.

An **author graph** is the subgraph of claims and inferences attributed to the author (including all inferred elements). Support analysis runs over the author graph; relations connect it to opposing material.

### Formalization (deductive steps only)

Reconstruction may attach an optional `formalization` to `deductive` inferences:

```ts
type Formalization = {
  atoms: Record<string, ClaimLocalId>;   // e.g. { P: "c1", Q: "c2" }
  premises: Formula[];                    // one per premise, in premise order
  conclusion: Formula;
};
type Formula =
  | { atom: string }
  | { not: Formula }
  | { and: Formula[] }
  | { or: Formula[] }
  | { implies: [Formula, Formula] };
```

`Formula` is the one documented exception to §7.2's "types inferred from Zod schemas": a recursive
union needs `z.lazy` with an explicit `z.ZodType<Formula>` annotation, so the hand-written type is
the source of truth and the schema is checked against it.

The analysis layer checks entailment by enumerating assignments (§3). Deductive steps without a formalization produce `unchecked_step` (info), never `invalid_step`; so do formalizations whose atom count exceeds the checker's limit. Conditionals must be formalized in the direction the text states them (§8.3).

---

## 7. Phase 1 — Argument structure and validation

**Goal:** a complete, tested domain model, analysis engine, and persistence layer, usable without any LLM.

### 7.1 Scaffolding — **complete**

All seven workspaces exist and are wired together:

- pnpm workspace with a shared version catalog; Turborepo tasks (`build`, `dev`, `test`, `test:db`, `lint`, `typecheck`) with `globalEnv` declared; shared tsconfig/eslint/vitest presets in `packages/config`.
- `docker-compose.yml` with Postgres 18, plus `pnpm db:up` / `db:down` / `db:logs`.
- `.env.example` documenting all variables (§10), parsed by the Zod schema in `packages/domain/src/config/env.ts` and used by both apps.
- Import boundaries enforced and self-tested (§4).
- `apps/web`: Next.js App Router with Tailwind v4 and shadcn/ui initialised; the landing page is still the stock Next.js page.
- `apps/worker`: structured JSON logging and fail-fast config parsing; not yet a pg-boss consumer.

### 7.2 `packages/domain`

- Zod schemas and inferred types for every entity in §6, plus `ArgumentGraph` (a revision's complete structure: claims, occurrences, inferences, premises, relations, findings) and `ArgumentGraphDraft` (same shape using local IDs, as produced by the pipeline).
- Branded ID types (`DocumentId`, `ClaimId`, …).
- Repository interfaces (§5.2).
- No I/O, no Drizzle, no LangChain imports.

### 7.3 `packages/analysis`

Two parts, both pure and deterministic.

**Structural validation** — `validateArgumentGraph(draft): ValidationResult` returns typed, human-readable `errors` (which block the run and are fed back to the LLM) and `warnings` (which do not). Rules include at least:

- every local ID referenced exists and is unique;
- exactly one thesis;
- every stated claim has ≥1 occurrence referencing an existing span; inferred claims have none;
- every inference has ≥1 premise and exactly one conclusion; the conclusion is not among its own premises;
- no two inferences have the same conclusion and the identical premise set (duplicate routes);
- an `author` inference has only `author` premises and an `author` conclusion; an `opposing` or `third_party` inference uses only claims of its own attribution;
- the thesis is attributed to `author`; inferred claims and inferences are attributed to `author`;
- every relation has exactly one target; relation sources and targets have different attributions unless the type is `qualify`;
- enum values valid; `confidence` in [0, 1];
- the thesis is reachable: it is the conclusion of at least one inference, or the graph has a single claim (degenerate argument, allowed but flagged);
- claims other than the thesis that participate in no inference or relation are **warnings, not errors** (briefs contain background such as standards of review); they do not trigger a retry and are reported as `unconnected_claim` findings;
- no inference lists the same premise claim twice (duplicates corrupt the joint-requirement count in support analysis);
- an `InferencePremise.origin` agrees with the `origin` of the claim it points at;
- when a relation targets an inference, the attribution compared against the source is that inference's `attribution`;
- `formalization`, if present, references only premise and conclusion claims of that inference, and has one formula per premise.

**Logical analysis** — `analyzeArgumentGraph(graph): Finding[]`, composed of independent analyzers, each with a `name` and `version`:

| Analyzer | Finding | Logic |
|---|---|---|
| implicit-premise | `implicit_premise` | Every claim with `origin: "inferred"` used as a premise. Severity `warning`; `critical` if also load-bearing. |
| load-bearing | `load_bearing` | Over the author graph, model support as an AND/OR graph: a ground claim (concluded by no inference) is assumed supported; a claim is supported if **any** inference concluding it holds (OR); an inference holds if **all** its premises are supported (AND). Computed as a least fixed point, so a claim supported only by reasoning that depends on it in turn is **not** supported — the graph does not get to assume what it is proving. A claim is load-bearing if removing it leaves the thesis unsupported; the thesis itself is never reported. Brute-force per-claim removal is acceptable (graphs are small). Severity `info`. Attacks do not affect support in v1. |

**Scope.** All six analyzers run over the **author graph** only. The tool reports on the reasoning
its user is responsible for; it does not grade a reconstruction of the opponent's. This matters most
for `deductive-validity`: §8.3 rule 7 has reconstruction model the opponent's own inference so that
an undercutting attack has a target, and that inference may well be invalid — flagging it would both
misread the product's purpose and contradict fixture 04.

**Load-bearing when nothing grounds the thesis.** On a circular argument the least fixed point
leaves the thesis unsupported, which would make "removing X leaves the thesis unsupported" vacuously
true of every claim. So load-bearing is computed against a baseline in which claims inside a cycle
are seeded as given. On fixture 06 that flags the one claim the rest of the brief leans on, rather
than everything or nothing. On an acyclic graph the seeding is a no-op.
| circularity | `circularity` | Cycle detection over claim → inference → conclusion edges using graphology's strongly-connected components. **One finding per non-trivial SCC**, not per simple cycle (enumerating simple cycles is exponential and double-reports the same loop). Targets are the cycle's claims and inferences in traversal order. Severity `critical`. |
| unsupported-claim | `unsupported_claim` | Author-attributed, **stated**, load-bearing ground claims of kind `factual`, `causal`, or `predictive` that have **no citation**. These are what the argument asks the reader to simply accept. Inferred claims are excluded: they can never carry a citation and are already reported as `implicit_premise`. Severity `warning`. |
| unconnected-claim | `unconnected_claim` | Claims (other than the thesis) in no inference or relation. Severity `info`. |
| deductive-validity | `invalid_step` / `unchecked_step` | For `deductive` inferences with a formalization: check whether premises ∧ ¬conclusion is satisfiable; if so, `invalid_step` (`critical`) with a counterexample assignment in the explanation. A step that is checked and valid produces **no finding** — there is no `valid_step` kind, and absence is the encoding. Deductive steps without a formalization, or whose formalization exceeds the checker's atom limit, produce `unchecked_step` (`info`) and never `invalid_step`. |

Explanations are plain English, reference claims by their canonical text, and follow the guardrails in §1.

Severity summary: `critical` — circularity, invalid_step, load-bearing implicit premise; `warning` — non-load-bearing implicit premise, unsupported_claim; `info` — load_bearing, unchecked_step, unconnected_claim. A fully stated, well-cited valid argument (fixture 01) produces only `info` findings.

### 7.4 `packages/persistence`

- Drizzle schema mirroring `docs/argument-model.mermaid` (snake_case columns, FKs, enum types, indexes on all FKs and a unique index on `(run_id, sequence)` for events).
- Constraints the ER diagram cannot express: CHECK exactly one of `target_claim_id` / `target_inference_id` on `relation` and of `claim_id` / `inference_id` on `finding_target`; CHECK `confidence` in `[0, 1]`; a partial unique index on `claim (revision_id) WHERE is_thesis` enforcing one thesis per revision. `occurrence`, `inference_premise` and `finding_target` use composite primary keys, not surrogate ids.
- Migrations via drizzle-kit, committed to the repo.
- Mappers (`toDomain` / `toRow`) per entity; mapper unit tests for round-tripping.
- Repository implementations of every interface in §5.2. `saveArgumentGraph` is a single transaction.
- Local-ID → UUID mapping (`assignIds`, `draftToGraph`) lives in `packages/domain/src/graph/materialize.ts`, not in `pipeline`. It was first written in persistence, but it is pure and both implementations of `saveAnalysisResult` (Drizzle and the in-memory fake) need it. One function assigns a UUID per local ID and rewrites claims, occurrences, inferences, premises, relations, finding targets **and `formalization.atoms`**, so a persisted formalization points at real claim IDs rather than leaving local IDs inside a JSON column.

### 7.5 Phase 1 acceptance criteria

- Hand-built `ArgumentGraph` fixtures in `packages/analysis/test/fixtures/` that mirror the reconstructions described in the answer keys of `fixtures/arguments/` 01, 02, 04, 05, 06, 07, 08 and 14, asserting the findings those answer keys expect. In particular:
  - **05 contract notice** — rule (C1) + fact (C2) + inferred premise C4 ("an email satisfies the written-notice requirement") → thesis (C3). Expected: `implicit_premise` (critical) on C4; `load_bearing` on C1, C2, C4.
  - **02 alternative routes** — three inferences concluding "appeal timely"; only the shared filing-date claim is load-bearing.
  - **04 attribution** — opposing claims excluded from support; rebut, undermine and undercut relations validate.
  - **08 / 14 citations** — exactly one uncited load-bearing fact flagged; cited facts not flagged.
  - plus a graph failing several validation rules, and one with an unconnected background claim (warning only).
- Fixtures are built with a small test-only builder DSL rather than raw object literals, and
  `build()` performs no validation or repair, so the validation-failure fixture can emit genuinely
  broken graphs.
- Fixture 14 is reduced to roughly 20 claims that preserve every behaviour its answer key names (two
  alternative routes, the non-load-bearing inferred premise, the single uncited load-bearing fact,
  rebut/undermine/undercut, hedged modality, one unconnected background claim). Its keys that need
  the whole brief — `claim_count`, `spans_with_function`, occurrence counts — are segmentation,
  classification and extraction properties, which a hand-typed graph cannot honestly demonstrate;
  they belong to `pnpm eval` (§8.7). Algorithm behaviour at scale is covered by **generated** graphs
  (a long support chain, a wide alternative-route fan-in, a large cycle) asserting termination,
  correct load-bearing and a runtime bound.
- A test reads each real `NN-name.expected.yaml` and scores it with the **same** scorer `pnpm eval`
  uses (`packages/answer-keys`), so fixtures and answer keys cannot drift apart and the hard keys
  have exactly one implementation. A hand-built graph has no spans, so it passes `spans: null` and
  the discourse-function keys come back `skipped`.
- `pnpm test` passes; analysis coverage ≥ 90%.
- `pnpm test:db` round-trips a full `ArgumentGraph` — inferred claims, multi-occurrence claims,
  opposing claims, all four relation types, a formalization, findings with multiple ordered targets —
  through Postgres unchanged, and a forced mid-save failure leaves nothing written.

### 7.6 Testing strategy

- **`pnpm test` is unit-only and must pass with no Docker running.** The shared Vitest preset
  excludes `**/*.integration.test.ts`.
- **`pnpm test:db`** runs the repository integration tests (and the pipeline's checkpointer test) against the local Compose Postgres, in a
  separate `makeyourcase_test` database addressed by `TEST_DATABASE_URL`. The helper creates the
  database if absent and applies migrations before the suite (a Compose init script would not do it:
  those run only on a fresh volume).
- `apps/web` tests run under Node like every other package; a View test opts into a DOM with a
  `// @vitest-environment jsdom` docblock, so server and ViewModel tests cannot reach for `window`.
- Isolation is `TRUNCATE ... RESTART IDENTITY CASCADE` between tests, deliberately **not** an outer
  transaction with savepoints — `saveArgumentGraph`'s own transaction is a thing §5.2 requires us to
  test, and wrapping it would mask commit and rollback bugs in exactly that code.
- Each package's `lint` script is `eslint .`, not `eslint src`: a lint gate that skips `test/` is not
  a gate, and the test files had accumulated errors nobody saw.
- Unit tests that depend on a repository use the in-memory fakes exported from
  `@make-your-case/domain/testing`, not ad-hoc mocks. They live in `domain` because `pipeline` may
  never import `persistence` (§4), so that is the only package every consumer can reach.

---

## 8. Phase 2 — LLM integration

**Goal:** a LangGraph workflow that turns pasted Markdown into a validated, analyzed, persisted `ArgumentGraph`, running in a background worker with live progress.

### 8.1 Provider abstraction (`packages/pipeline/src/llm/`) — **complete**

- Configuration resolves per stage. `LLM_PROVIDER` and `LLM_MODEL_DEFAULT` apply to every stage; the optional `LLM_PROVIDER_<STAGE>` and `LLM_MODEL_<STAGE>` override them for `classify`, `extract`, `reconstruct` and `judge`. `resolveLlmConfig(env, stages)` (`packages/domain/src/config/llm.ts`) returns the provider, model and API key for each requested stage, or every problem at once, naming variables but never values. `parseEnv` stays key-free because `apps/web` never calls a model; the worker resolves the three pipeline stages, the eval harness adds `judge`.
- `ModelProvider` port: `getChatModel(stage: LlmStage): BaseChatModel` plus `describe()`, the secret-free `{ stage: { provider, model } }` recorded in `AnalysisRun.model_config`. `createModelProvider(config)` builds `ChatAnthropic` or `ChatOpenAI`; an exhaustive `switch` makes a new provider (Bedrock via `@langchain/aws`, an OpenAI-compatible endpoint for self-hosted models) one new case plus its key variable. No sampling parameters are set: several current models reject `temperature`.
- Stage code calls models only through `invokeStructured(model, schema, messages, name)`, a wrapper over `withStructuredOutput(zodSchema)`. It never depends on provider-specific features.
- Models produce **wire schemas** (`packages/pipeline/src/schemas/wire.ts`), not domain schemas: strict structured-output modes reject brands, refinements, defaults and optional fields, so every field is required (nullable where absent), IDs are plain strings, and occurrences and premise IDs nest under their claims and inferences. `reconstructResponseToDraft` flattens them into an `ArgumentGraphDraft`; field-level problems surface as `validateArgumentGraph` errors and go back to the model.
- `Formula` is recursive, and a recursive schema compiles to a self-`$ref` that providers support inconsistently, while a depth-bounded copy grows exponentially. Models therefore emit a formalization as a **flat node list** (`{ id, op, atom, args }` with root IDs per premise and conclusion), which `buildFormula` turns into the tree, rejecting dangling references, cycles and bad arity as validation errors.
- `pnpm --filter @make-your-case/pipeline smoke:structured` makes one real call per configured stage to confirm the provider accepts the wire schemas. It is billed, never runs in `pnpm test`, and is for the maintainer to run (§12).
- Record the provider and model used per stage in `AnalysisRun.model_config`.
- `FakeModelProvider` (`@make-your-case/pipeline/testing`) returns scripted structured responses or errors from a per-stage queue, parses each through the caller's schema, and records every prompt for assertions.

### 8.2 Workflow graph

```
segment → classify → [gate] → extract → reconstruct → validate ─┬→ analyze → persist → END
                       │                     ▲                   │
                       └→ not_an_argument    └── (errors, ≤3) ───┘
                                                  └ (still failing) → fail
```

| Node | Kind | Responsibility |
|---|---|---|
| `segment` | deterministic | Parse Markdown (remark/mdast for positions), split into sentence spans with `Intl.Segmenter`, compute offsets against the original source text, assign local IDs and ordinals. Exclude pure formatting (headings markers, list bullets) from offsets but keep headings as their own spans. |
| `classify` | LLM | Label each span's discourse function with confidence. Batch spans; include neighboring context. Point headings that state a conclusion ("I. The Department's silence was a denial") are `argumentative`; plain section headings and titles are not. |
| gate | conditional edge | If the count of `argumentative` spans above a confidence threshold is below a configurable minimum (`GATE_MIN_ARGUMENTATIVE_SPANS`, default 2), end with run status `not_an_argument` and a short genre `summary`. |
| `extract` | LLM | Produce claims (with occurrences by span ID and surface text, attribution, and citation), the thesis, inferences, and relations as an `ArgumentGraphDraft`. Stated content only. Send the whole document; do not chunk in v1. **Classification informs extraction but never filters it**: premises are often stated only in narrative sections (a Statement of Facts) and referenced from the argument, so occurrences may anchor to spans of any function. Resolve internal cross-references to the cited paragraph. |
| `reconstruct` | LLM | Canonicalize claim text, merge duplicate claims (combining occurrences), assign `kind`/`modality`/`scheme`, split alternative routes into separate inferences, add implicit premises as `origin: "inferred"`, and add formalizations for deductive rule-application steps, following the policy in §8.3. Must not alter or remove stated content's occurrences, attribution, or citations. |
| `validate` | deterministic | Run `validateArgumentGraph`. On errors, route back to `reconstruct` with the error list in state. Max 3 retries, then fail the run. |
| `analyze` | deterministic | Run `analyzeArgumentGraph`. |
| `persist` | I/O | Map local IDs to UUIDs; save spans, revision, and graph in one transaction via injected repositories; link revision to run. |

Stage logic (`packages/pipeline/src/stages/`, prompts in `src/prompts/`) and the workflow (`src/workflow/`) — **complete**:

- `createAnalysisWorkflow(deps)` compiles the graph above with `Annotation.Root` state. Dependencies are injected: a `ModelProvider`, a `ProgressReporter` bound to one run (so the workflow is compiled per run), `RevisionRepository.saveAnalysisResult`, the retry and gate settings, and a checkpointer. Each node is a thin adapter over a stage function; `withStage` reports `stage_started` and `stage_completed` around it.
- `PIPELINE_MAX_VALIDATION_RETRIES` counts retries, so reconstruct runs at most that number plus one times. The `not_an_argument` exit reports under the `classify` stage.
- `runAnalysis(workflow, input)` uses the run ID as the checkpoint thread. With no checkpoint it starts; with an unfinished one it resumes; with a finished one it returns the recorded outcome without calling any model. It returns `completed` (with the revision), `not_an_argument` (with the summary) or `failed` (with a user-safe message). Unexpected errors propagate to the worker.
- `createPostgresCheckpointer(url)` keeps LangGraph's tables in their own `langgraph` schema, apart from the tables `persistence` migrates. `packages/pipeline` has its own `pnpm test:db` that resumes a failed run from a Postgres checkpoint in a fresh workflow.
- `RecordingProgressReporter` and `FakeModelProvider` (`@make-your-case/pipeline/testing`) drive the end-to-end workflow tests in `packages/pipeline/test/workflow.test.ts`.


- `segmentDocument` parses with `remark-parse`, splits paragraphs with `Intl.Segmenter`, then rejoins false breaks inside legal citations ("Smith v. Jones", "Lab. Code § 22", "Okafor Decl. ¶ 3"): a piece starting with a lowercase letter, digit, `§` or `¶` continues the previous one, as does a piece following a known abbreviation or an initial. Each heading is one span. List markers are excluded from offsets but kept as pipeline-side context (`SegmentedSpan.listMarker`) and rendered into prompts, so extraction can resolve "Undisputed Fact ¶ 17".
- `extract` output stays in wire form (`ExtractResponse`); it is reconstruct's input and the reference for `checkPreservation`, which turns any extracted occurrence missing from the reconstruction (matched by span and attribution), or any lost citation, into a validation error. Matching is not by exact wording: merging moves occurrences between claim IDs and models rarely reproduce surface text exactly.
- `reconstructResponseToDraft` also rejects a formalization whose conclusion has an atom no premise mentions: such a step is invalid by construction, so it is a modelling error to retry, not an `invalid_step` about the author.
- `retryFeedback` appends hints to validation messages for errors with a known model cause (an extra premise formula almost always means a rule was formalized without being added as a premise).
- `invokeStructured` requests the raw response alongside the parsed one, because a response that fails the schema is usually recoverable. The recurring failure on large nested outputs is a top-level array field arriving as JSON *text* rather than JSON, and the damage takes several shapes: the string may hold only that field's value, or the object's remaining fields as well, sometimes with the closing brace or a trailing comma attached; sometimes the whole argument object arrives as text; sometimes the output simply stops mid-element. Rather than guess, `repairCandidates` proposes every plausible reading and **the schema decides** — a wrong candidate just fails to validate. Lossless readings are exhausted before any that salvaged a truncated response, so discarding part of the output is a last resort and not an accident of ordering.
- A truncated response is salvaged by dropping the incomplete trailing element. That loses data deliberately: a reconstruction missing its last claim fails `validateArgumentGraph` with a specific complaint the retry loop can act on, whereas an unparseable response fails the whole run.
- **A retry is not the same request.** Asking again identically invites the same answer, which is why a deterministic malformation used to exhaust all three attempts; so each retry carries a short note naming the schema paths that did not match, or asking for a more concise response when the output was cut short. The note names paths only — never the model's output, which can contain document text (§11).
- `StructuredOutputError` names schema paths, never model output, and says when the output was cut short, because truncation needs a different fix (a larger budget or a shorter prompt) from malformation (a prompt or schema change).
- Prompts must not use fixture content as examples, or the eval measures memorization: worked examples come from unrelated domains.
- `pnpm --filter @make-your-case/pipeline try:stages <file.md>` runs the stages in sequence with the retry loop and prints claims and findings. It is a billed development aid for prompt work.

- Validation **warnings** (e.g. unconnected claims) never trigger a retry; only errors do.
- State is a typed LangGraph state annotation; every node is a separately testable function.
- Use the Postgres checkpointer so a crashed run can resume.
- Prompts live in `packages/pipeline/src/prompts/` as versioned modules; each prompt states the guardrails from §1 explicitly. Record prompt versions in `model_config`.
- If the document exceeds a configurable size limit (`MAX_DOCUMENT_CHARS`), reject at submission with a clear error rather than truncating.

### 8.3 Reconstruction policy (faithful before charitable)

These rules go into the reconstruction prompt verbatim in substance and are tested by the fixtures named.

1. **Add a premise only to complete a step that is genuinely incomplete**: the author draws a conclusion that does not follow from what they stated without some unstated rule or fact (fixture 05, and the waiver route in 14). Mark it `inferred`, state it as the minimum needed, and attach it to the inference it completes.
2. **Never add a premise to a step whose premises the author fully stated** (fixture 01 must produce no inferred claims). Do not add obvious arithmetic or definitional premises the text already states.
3. **Never repair stated reasoning.** If the text states a conditional in one direction ("certified work is code-compliant") and reasons from it in the other, formalize the conditional as stated and let analysis report `invalid_step`. Do not add the converse, and do not formalize a stated one-way conditional as a biconditional (fixture 07).
4. **Preserve circular structure.** Do not merge two claims that support each other into one; keep the cycle visible (fixture 06).
5. **Merge true restatements only.** Merge claims that assert the same proposition in different words (fixture 09); keep evidence for a claim (a signed receipt, testimony) as a separate supporting claim.
6. **Preserve modality** exactly; never strengthen a hedged claim (fixture 10).
7. **Keep attribution.** The opponent's position stays attributed to the opponent; reconstruction may model the opponent's own inference so that undercutting attacks have a target (fixtures 04, 14).
8. **Represent alternative routes as separate inferences** (fixtures 02, 14).

### 8.4 Progress feedback

- Each node emits `stage_started`, optional `stage_progress` (e.g. "classified 40 / 120 spans"), and `stage_completed` events through an injected `ProgressReporter`, which the worker implements by appending `RunEvent` rows (monotonic `sequence` per run) and updating `AnalysisRun.current_stage`.
- Validation retries emit `validation_retry` with the error count; failures emit `run_failed` with a user-safe message.
- Event payloads must be safe to show users: no raw prompts, no API keys, no stack traces.

### 8.5 Worker (`apps/worker`) — **complete**

- pg-boss consumer for `analyze-document` jobs. Composition root: it owns the database pool, the model provider, the Postgres checkpointer and the queue, builds the repositories, and closes all of them in order.
- **The queue contract lives in `domain`** (`ANALYZE_DOCUMENT_QUEUE`, `analyzeDocumentJobSchema`), because both sides need it and neither can reach the other: `apps/web` enqueues but may not import `pipeline` (§4). Only identifiers travel on the queue — the document text is already in the database and immutable, so sending it would duplicate it and put the user's document in the job table. A payload is parsed on arrival: it round-trips through JSON and may have been enqueued by an older build.
- pg-boss 12 notes: the package is ESM with a **named** `PgBoss` export, `createQueue` must be called before a queue is worked, and a work handler receives a **batch** (`Job<T>[]`). The handler iterates the batch rather than taking `jobs[0]`, so raising the batch size later cannot silently drop work.
- `handleAnalyzeDocument` is separate from the queue plumbing so it can be tested with in-memory repositories and a `FakeModelProvider`, with no queue and no database.
- **The run's lifecycle belongs here, not to the pipeline.** `createAnalysisWorkflow` is given only `saveAnalysisResult`, so nothing in `pipeline` sets a run's status, timestamps or `model_config` — before this, every run stayed `queued` for ever. `run-lifecycle.ts` marks a run `running` with its `started_at` and `model_config`, and maps each `AnalysisOutcome` onto its terminal state.
- `DatabaseProgressReporter` implements §8.4: every pipeline event becomes a `RunEvent` row and `current_stage` moves as each stage starts. `appendEvent` assigns the monotonic sequence in SQL, so the SSE stream can resume from `Last-Event-ID` without the reporter tracking position.
- A redelivered job whose run already finished does nothing: repeating it would spend money and duplicate the events a client is watching.
- An unexpected failure (a provider outage, output that never matches the schema) fails the run with a fixed, uninformative message and logs the detail. The error is **rethrown** so the queue records the job as failed; the checkpoint means a redelivery resumes rather than repeating paid work.
- `SIGINT`/`SIGTERM` stop the queue gracefully, letting an in-flight run finish, then close the checkpointer and the pool.
- `apps/worker` has two tsconfigs: `tsconfig.json` covers `src` and `test` for typecheck and lint, and `tsconfig.build.json` is the only place `rootDir`/`outDir` appear. A lint and typecheck that skip `test/` are not worth having.

### 8.6 API (`apps/web/src/app/api/`) — **complete**

Route handlers are thin; logic lives in server-side services that depend on repository interfaces.

| Method & path | Purpose |
|---|---|
| `POST /api/documents` | Body `{ title?, role?, sourceText }`. Validate size, create document + run, enqueue job. Returns `{ documentId, runId }`. |
| `GET /api/documents` | List documents with latest run status. |
| `GET /api/documents/:id` | Document with source text and spans. |
| `GET /api/documents/:id/argument` | Latest revision's `ArgumentGraph` with findings. |
| `GET /api/runs/:id` | Run status. |
| `GET /api/runs/:id/events` | Server-Sent Events stream of `RunEvent`s; supports `Last-Event-ID` resume; closes on terminal status. Polling the events table (≈500 ms) is acceptable in v1. |

All request and response bodies are validated with Zod schemas shared from `packages/domain/src/contracts/api.ts`.

- **Wire format.** Entities use `z.date()`, which JSON cannot carry, so each wire schema swaps its dates for an ISO-string codec (`isoDate`). The server writes bodies with `encodeWire` and the client reads them with `decodeWire`; neither hand-converts a date, and `apps/web` needs no zod of its own (it may not import it). `ArgumentGraph` is a declared interface, so it has its own `encodeArgumentResponse`/`decodeArgumentResponse`. Entity bodies keep the domain's snake_case; the submit request and response are camelCase as the table above gives them. Every error is `{ error: { code, message } }` with `validation_failed` 400, `not_found` 404, `document_too_large` 413, `internal` 500.
- **`GET /api/documents/:id`** returns `{ document, spans, latestRun }`. `latestRun` is how the page finds the run to stream; it is the most recently *requested* run, ordered by `analysis_run.created_at` (added for this — a queued run has no `started_at`).
- **The SSE stream** sends one unnamed event per `RunEvent` with `id:` set to its sequence, then a named `end` event (`{ status }`) once the run is terminal, then closes. It resumes from `Last-Event-ID`, or from `?after=<sequence>` for a client reconnecting by hand (a new `EventSource` cannot set the header). Each poll reads the run's status before its events: the worker writes events before the terminal status, so a terminal read means the following poll drains everything.
- **Composition root.** `src/server/container.ts` caches the pool and pg-boss on `globalThis` under a registered symbol, so a dev-mode reload reuses them instead of leaking a pool; services are plain functions built per request. Route files only forward to `src/server/api.ts`, which is where authentication will go. Enqueue failures mark the run `failed` with a safe message.

### 8.7 Evaluation harness — **complete**

Fixtures live in `fixtures/arguments/` as pairs: `NN-name.md` (exactly what a user would paste; never sent with its answer key) and `NN-name.expected.yaml` (the answer key). The harness must not hard-code fixture content; everything it checks comes from the answer keys.

**Answer-key schema** (define in Zod; reject unknown keys under `hard` so the schema and fixtures stay in sync):

```yaml
id: string                       # matches the file stem
purpose: string
expected_status: completed | not_an_argument
thesis: string | null            # paraphrase; graded softly
hard:                            # every key optional; all present keys must pass
  argument_graph: absent         # no revision produced
  findings_present: [{ kind, severity? }]
  findings_absent: [kind]
  findings_max_severity: info | warning | critical
  claim_count: { min?, max? }
  inference_count: { min?, max? }
  relations_count: { min?, max? }
  relations_present: [rebut | undermine | undercut | qualify]
  inferred_claims: { min?, max? }
  unsupported_claim_count: { min?, max? }
  max_occurrences_for_single_claim: { min?, max? }   # the most-occurring claim's count
  claims_with_modality_not_asserted: { min?, max? }
  spans_with_function: { <function>: { min?, max? } }
  claim_occurrences_in_function: { <function>: { min?, max? } }  # occurrences anchored in spans of that function
soft:                            # graded by the judge; a value may nest one or more levels
  <any key>: string | string[] | { <any key>: ... }
expected_failures:               # optional: a written explanation per hard-check row
  <row key>: string              #   e.g. relations_present[undercut]
notes: string
```

`soft` nests because fixture 14 groups six behaviours under `embedded_behaviors`, which reads better
than six top-level keys. The judge grades the **leaves**, each identified by its dotted path
(`embedded_behaviors.alternative_routes`), so grouping costs nothing in precision. A `string[]` is
one leaf, not many: the items describe a single expectation together.

`thesis` sits outside `soft` but is documented as graded softly, so the harness synthesizes a
`thesis` leaf for it; otherwise nothing would grade it.

`expected_failures` is how §8.8's "written explanation of each failure" is satisfied durably. A row
named there is reported as **explained** rather than failed and does not gate the exit code. The
explanation lives beside the expectation it excuses, so the two are reviewed together — a generated
report is ephemeral and a separate document drifts.

**Where the pieces live.** `packages/answer-keys` holds the schema, the loader and the deterministic
scorer, and is pure (domain types in, pass/fail out). It is a package rather than part of `tools/eval`
because `packages/analysis`'s acceptance test scores hand-built graphs with the same scorer, and
`analysis` cannot depend on a tool without a workspace cycle. `tools/eval` holds the judge, the CLI
and the report.

**Scoring**

- Hard checks are deterministic and produce pass, fail, **explained** (named in `expected_failures`)
  or **skipped** (the caller cannot answer the key) per row. A key absent from the answer key produces
  no row at all, so a report never takes credit for a property it did not check.
- **The subject is the final workflow state, not the saved revision.** `getArgumentGraph` orders rows
  by UUID, so a saved graph comes back differently every run, which would make a report and a judge
  prompt that are meant to be compared across runs change shape for no reason. The state also keeps
  spans and the graph in one ID space, and is the only source that exists on both outcome paths — a
  `not_an_argument` run persists nothing, yet fixtures 11 and 12 still constrain how its spans were
  classified. That `persist` worked is checked separately, as a `persistence_roundtrip` row comparing
  the saved revision's cardinalities against the draft.
- **`spans_with_function` counts only spans the classifier was confident about**, using the same
  threshold the gate uses. A hedged stray label is not the system claiming the text argues, and
  fixture 11 asks for no argumentative spans. The report prints both numbers.
- `findings_present` with a severity is satisfied when *at least one* finding of that kind has it.
- Soft expectations are graded by a judge model (configured via `LLM_MODEL_JUDGE`) that receives the source text, the soft expectations, and a readable rendering of the produced graph and findings, and returns `pass | partial | fail` with a one-paragraph rationale per soft key. Judge prompts are versioned like pipeline prompts.
- `pnpm eval [--fixture NN] [--repeat N] [--no-judge] [--database-url <url>] [--out <dir>]` runs the real pipeline,
  scores every fixture, and writes `eval-results/<timestamp>/report.md` and `report.json` (per fixture:
  status, hard results, soft grades, counts, findings by kind, retries, stage durations, and the
  run-level models and prompt versions). It never runs in the default test suite, and is not a
  Turborepo task: the run is billed, and a cached eval result is worse than no result.
- Execution is sequential. Fourteen fixtures is around a hundred calls; concurrency turns a rate
  limit into perturbed results, and §2 puts latency optimization out of scope.
- **`--repeat N` attempts each fixture N times and reports pass rates**, because the pipeline is
  non-deterministic: the same fixture and prompts can complete, error, or fail a different check from
  one run to the next. A single run cannot tell a prompt improvement from variance, so a prompt change
  must be judged against a repeated baseline. The report names the checks that passed on some
  attempts and failed on others, and the exit code requires *every* attempt to pass — a gate must not
  pass on a coin flip.
- The report records the validation errors from the last `validate`. On a retry-exhausted or errored
  run those are what the model was being asked to fix, which is the signal prompt work runs on.
- Each fixture is isolated: `runAnalysis` propagates unexpected failures by contract, so a throw
  becomes an `errored` row and the sweep continues. Losing thirteen fixtures to one provider hiccup
  would be the harness's worst failure mode. The judge is isolated separately, so a judge outage
  cannot cost the deterministic results already paid for.
- It writes into `DATABASE_URL` by default, so each run leaves inspectable documents and revisions
  behind for Phase 3 to explore. **The dev database must be migrated first** (`pnpm db:up` then
  `pnpm db:migrate`); the harness checks and says so rather than failing inside the driver.
- Exit codes: 0 every selected fixture passed, 1 a fixture failed or errored, 2 a usage or
  configuration problem — so "the eval is broken" is distinguishable from "the pipeline got worse".
- Some answer keys reference behavior that depends on schema changes (attribution, citations). Those are in v1 scope; a failing expectation is a bug, not a fixture to skip.

### 8.8 Phase 2 acceptance criteria

- Unit tests for every deterministic node; pipeline tests run end-to-end with `FakeModelProvider`, including: non-argument exit, validation retry that recovers, validation retry that fails, and unconnected claims that warn without retrying.
- Answer-key schema and hard checks have unit tests using hand-built graphs.
- `pnpm eval` runs over all fixtures. Target for completing Phase 2: every fixture's `expected_status` and all hard checks pass on fixtures 01–13; fixture 14 passes all hard checks or has a written explanation of each failure (`expected_failures`, §8.7).

**Where that target stands.**

Fixed: **every model call was capped at 4096 output tokens.** `ChatAnthropic` takes its default from
a table of model-name prefixes, and a model the table does not know falls back to 4096 — so
`reconstruct` was truncated mid-object, leaving a JSON string no repair could parse. The budget is
now set explicitly (§8.1). Fixture 05, the canonical implicit-premise case, passes all its hard
checks as a result.

Open, measured on fixture 01 over five attempts (`--repeat 5`) against `claude-haiku-4-5`, which
passed **0 of 5**. Both may behave differently on a more capable model, which is how they will next
be measured (§12):

1. ~~**Reconstruct's structured output is unreliable — 3 of 5 attempts.**~~ **Addressed, unmeasured.**
   A top-level array field (`claims` on two attempts, `inferences` on another) arrived as a JSON
   *string* that the repair could not recover, three attempts running. Two causes were found by
   reading the code: the repair handled only two of the shapes the damage takes (it broke on a
   trailing brace, a trailing comma, a stringified argument object, a nested whole response, and
   truncation), and a failed attempt repeated the *identical* request, so a deterministic
   malformation was guaranteed to fail all three times. Both are fixed and covered by deterministic
   tests over hand-built payloads (§8.1). Whether the error rate is actually gone needs a billed
   sweep, which is the maintainer's to run (§12).
2. **Formalizations do not entail their conclusions — both attempts that completed.** Fixture 01 is
   a valid rule application and its key forbids `invalid_step`, but the step the model formalizes is
   propositionally invalid, which also breaks `findings_max_severity: info`.

Prompt guidance for choosing a claim's `kind` was added in `reconstruct@2`, because the
`unsupported-claim` analyzer only fires on `factual`/`causal`/`predictive` and the model was typing
date arithmetic `factual` — making the analysis demand a citation for a subtraction. It is unproven:
the sample is too small to separate it from variance.
- Submitting a fixture via `POST /api/documents` locally yields live SSE progress and a persisted, analyzed revision.

---

## 9. Phase 3 — UI (React, MVVM)

**Goal:** a read-only interface to submit text, watch progress, and explore the analyzed argument.

### 9.1 MVVM conventions

- **Model**: domain types from `packages/domain`, obtained through a typed API client (`apps/web/src/client/api/`). The API client is the only code that calls `fetch` or opens EventSources.
- **ViewModel**: MobX classes in `apps/web/src/client/viewmodels/` (under `client/`, which is the directory the import boundary protects), one per screen or major panel. They hold observable state, expose `computed` derivations and action methods (commands), and depend on the API client via constructor injection. ViewModels contain no JSX and no DOM access.
- **View**: React components wrapped in `observer`. Views render ViewModel state and invoke ViewModel commands. No data fetching, no business logic, no derivations beyond trivial formatting.
- ViewModels are provided through React context at the screen level and disposed on unmount (close SSE connections, dispose reactions).
- ViewModels are unit-tested with a fake API client, without rendering.
- Do not introduce TanStack Query, Redux, Zustand, or other state libraries.

### 9.2 Screens

**New analysis** (`/`): title, optional role select, Markdown textarea, submit. Shows size-limit errors. Lists previous documents with status. On submit, navigates to the document page.

**Document** (`/documents/[id]`):

- While a run is in progress: a stage timeline (segment, classify, extract, reconstruct, validate, analyze, persist) driven by SSE, with progress messages and retry notices. On `not_an_argument`, show the explanation. On failure, show the safe error message.
- When complete, a three-panel layout:
  - **Source text** (left): the original Markdown, rendered with span boundaries. Hovering or selecting a span highlights the claims it supports; selecting a claim highlights its spans and scrolls to them.
  - **Argument map** (center): React Flow + ELK layered layout, thesis at top, support flowing upward. Claim nodes and inference nodes are distinct node types. Relations render as distinct edge styles by type.
  - **Inspector + findings** (right): a findings list grouped by severity, each clickable to focus the relevant elements; an inspector showing the selected element's details (canonical text, kind, modality, origin, attribution, citation, occurrences with surface text, confidence, related findings).

`ArgumentMapViewModel` computes React Flow nodes/edges and runs ELK layout; Views only render its output. Selection state is shared across panels through a screen-level `DocumentAnalysisViewModel`.

### 9.3 Visual encoding

- Inferred elements: dashed border plus an "Inferred" badge. Never rely on color alone.
- Thesis: distinct node style and label.
- Load-bearing claims: emphasized border plus an icon; critical findings shown as a badge with count.
- Claim kind shown as a text badge.
- Each inference is a node joining its premises; alternative routes appear as separate inference nodes into the same conclusion.
- Opposing and third-party claims and inferences: a distinct, clearly labeled style (e.g. "Opposing party") and grouped visually apart from the author's support tree.
- Claims with a citation show it in the inspector; uncited load-bearing facts are visibly marked.
- Must work in light and dark modes, be keyboard navigable (select nodes, move between findings), and meet WCAG AA contrast.

### 9.4 Phase 3 acceptance criteria

**Status:** the automated criteria pass; the manual sweep over real fixtures is the maintainer's (§12). Implemented as `src/client/{api,model,viewmodels,views}`:

- `model/` holds the pure derivations, each unit-tested: `indexArgument` (lookups, plus load-bearing and uncited sets read from the persisted findings, because the client may not import `analysis`), `highlightFor` (selection syncing as one function), `stageTimeline`, and `map-graph` (graph → map spec → ELK → React Flow).
- **Order is computed, not stored.** `getArgumentGraph` returns rows in UUID order, so the index sorts claims into reading order (first occurrence; an inferred claim beside the claim it supports), and the map is stable across reloads with no schema change.
- The source panel slices the submitted text at span offsets rather than rendering Markdown, so highlights land on exactly the characters segmentation measured; Markdown syntax shows as written.
- Dark mode follows `prefers-color-scheme` (no toggle). The severity, opposing and highlight tokens in `globals.css` were checked for WCAG AA contrast in both themes.
- `pnpm --filter @make-your-case/web seed:demo [--live]` writes a hand-built analysis (and, with `--live`, paces its events over ~10 s) with no model call, for exploring the UI without a billed run.

- ViewModel unit tests for selection syncing, findings focus, SSE event handling (including reconnection and terminal states), and graph-to-React-Flow mapping.
- Component tests for key Views using a stub ViewModel.
- Manually verified: submitting each fixture shows live progress and a navigable map in which every stated claim highlights its source text, every inferred element is visibly marked, and opposing material is visibly distinguished. Fixtures 11 and 12 show the non-argument summary.

---

## 10. Configuration

`.env.example` must document:

```
DATABASE_URL=postgres://...
LLM_PROVIDER=anthropic            # anthropic | openai (bedrock, openai-compatible: future)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
LLM_MODEL_DEFAULT=                # default model for all stages
LLM_MODEL_CLASSIFY=               # optional per-stage overrides
LLM_MODEL_EXTRACT=
LLM_MODEL_RECONSTRUCT=
LLM_MODEL_JUDGE=                  # eval harness only
LLM_PROVIDER_CLASSIFY=            # optional per-stage provider overrides
LLM_PROVIDER_EXTRACT=
LLM_PROVIDER_RECONSTRUCT=
LLM_PROVIDER_JUDGE=               # eval harness only
MAX_DOCUMENT_CHARS=200000
PIPELINE_MAX_VALIDATION_RETRIES=3
GATE_MIN_ARGUMENTATIVE_SPANS=2
TEST_DATABASE_URL=postgres://...   # `pnpm test:db` only; a separate database (§7.6)
```

Every variable must also be declared in `turbo.json`'s `globalEnv`, or Turborepo's strict env mode
strips it from tasks (§3).

Each stage's provider is `LLM_PROVIDER_<STAGE>` or else `LLM_PROVIDER`, and its model is `LLM_MODEL_<STAGE>` or else `LLM_MODEL_DEFAULT`; the API key is the one for the resolved provider. Blank values count as unset.

Configuration is parsed and validated with Zod at startup in each app; fail fast on invalid config. Secrets are never logged.

Migrations are applied explicitly, never implicitly by a tool: `pnpm db:up` then `pnpm db:migrate`.
Only the integration-test helper creates and migrates its own database (`TEST_DATABASE_URL`), so a
fresh clone has an empty `DATABASE_URL` database until `db:migrate` is run.

---

## 11. Engineering conventions

- TypeScript strict; no `any` (use `unknown` and narrow). No non-null assertions without a comment explaining why.
- Prefer pure functions and explicit dependency injection; no module-level singletons except at composition roots.
- Errors: typed result objects (`{ ok: true, value } | { ok: false, error }`) for expected failures in domain and analysis; exceptions only for unexpected failures.
- Logging: structured JSON logs in worker and API, including `runId` and `stage`. Never log document text, prompts, or model output at info level.
- Tests sit beside the code (`*.test.ts`) or in a package `test/` directory. Every bug fix adds a regression test.
- Keep this file current: when a decision in this document changes, update it in the same change.

## 12. Working agreement for agents

- **Do not run anything that calls a real model.** `pnpm eval`, `pnpm --filter @make-your-case/pipeline smoke:structured` and `try:stages` are billed, and their results vary run to run, so an agent cannot use them to judge its own work. Fix pipeline and prompt problems by reasoning about the code and covering the behaviour with deterministic tests (`FakeModelProvider`, hand-built payloads). The maintainer runs the billed sweeps, by hand, and will do so against a more capable model during the UI phase — several of the open issues in §8.8 may simply not reproduce there, so do not design around them as if they were permanent.
- Work phase by phase. Do not start a phase until the previous phase's acceptance criteria pass.
- Before writing code that uses an external library, check its current documentation.
- If a requirement here is ambiguous or conflicts with what you find in the code, stop and ask rather than guessing.
- Do not implement anything listed as out of scope, even partially, unless asked.

## 13. Future iterations (context only — do not build)

Authentication, RBAC and user management (required before deployment); argument editing with child revisions; PDF and DOCX ingestion; evidence linking with reliability assessment; competing hypotheses over shared facts; AIF JSON export; Bedrock and self-hosted model providers; long-document chunking strategies.

Analysis ideas surfaced while writing the fixtures:
- **Modality mismatch**: flag conclusions asserted more strongly than their premises allow (fixture 10's conclusion is appropriately hedged and must not trigger it).
- **Unanswered attacks**: flag opposing claims that rebut or undermine the author's argument without any counter-relation from the author; and let unanswered attacks affect support analysis.
- **Fixture gaps**: fiction that contains an argument (needs a decided expected behavior), a rhetoric-heavy op-ed, and a true length stress test (~10,000+ words).

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
