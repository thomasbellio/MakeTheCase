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
- Findings are framed as observations and questions ("this conclusion depends on an unstated premise"), not accusations or fallacy labels.
- The analysis layer is **deterministic**. LLMs interpret language; code evaluates structure. No LLM calls inside `packages/analysis`.

---

## 2. Scope of this iteration (v1)

### In scope

- Input: pasted text, treated as Markdown. Document text is immutable once submitted.
- Full pipeline: segmentation → classification → extraction → reconstruction → validation → analysis → persistence.
- Findings: `implicit_premise`, `load_bearing`, `circularity`, `unsupported_claim`, and validity checking **only** for deductive rule-application steps (`invalid_step` / `unchecked_step`).
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
| Language | TypeScript, `strict: true`, ESM |
| Monorepo | pnpm workspaces + Turborepo |
| Web app | Next.js (App Router), React |
| Database | PostgreSQL |
| ORM | Drizzle ORM + drizzle-kit migrations |
| Schemas / runtime validation | Zod |
| LLM orchestration | LangGraph JS (`@langchain/langgraph`) as an explicit **workflow graph**, not a supervisor/agent pattern |
| LLM providers | LangChain chat model integrations (e.g. `@langchain/anthropic`, `@langchain/openai`, `@langchain/aws`) behind our own provider factory |
| Workflow checkpointing | `@langchain/langgraph-checkpoint-postgres` |
| Background jobs | pg-boss (Postgres-backed queue) |
| Graph algorithms | graphology |
| Propositional validity | `logic-solver` (SAT) |
| Graph rendering | React Flow (`@xyflow/react`) |
| Graph layout | ELK.js (layered layout) |
| UI components | shadcn/ui + Tailwind CSS |
| UI state (MVVM) | MobX + `mobx-react-lite` |
| Testing | Vitest (unit/integration); Testcontainers or local Postgres for DB tests |
| Lint / format | ESLint + Prettier |

Verify current package versions at install time; do not rely on remembered APIs. Read each library's current docs before use, especially LangGraph JS and React Flow, whose APIs change between major versions.

---

## 4. Repository layout

```
make-your-case/
├── apps/
│   ├── web/                 # Next.js: UI (MVVM) + API route handlers
│   └── worker/              # Node process: pg-boss consumer that runs the pipeline
├── packages/
│   ├── domain/              # Plain domain types, Zod schemas, repository interfaces. No I/O.
│   ├── analysis/            # Structural validation + deterministic logical analysis. Pure functions.
│   ├── persistence/         # Drizzle schema, migrations, data mappers, repository implementations
│   ├── pipeline/            # LangGraph workflow, LLM provider factory, prompts, stage logic
│   └── config/              # Shared tsconfig, eslint, vitest presets
├── fixtures/
│   └── arguments/           # Test arguments supplied by the maintainer (Markdown)
├── docs/
│   └── argument-model.mermaid
├── docker-compose.yml       # Local Postgres only
├── CLAUDE.md
└── README.md
```

### Dependency rules (enforce with ESLint import boundaries)

```
domain       → (zod only)
analysis     → domain, graphology, logic-solver
persistence  → domain, drizzle
pipeline     → domain, analysis, langgraph/langchain   (NOT persistence; repositories are injected)
worker       → pipeline, persistence, analysis, domain (composition root)
web (server) → persistence, domain, pg-boss            (composition root for API)
web (client) → domain types only, via the API client
```

No package may import from an `apps/*` package. Client-side code in `apps/web` must never import `persistence`, `pipeline`, or server-only modules.

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
  appendEvent(event: NewRunEvent): Promise<RunEvent>;
  listEventsSince(runId: RunId, afterSequence: number): Promise<RunEvent[]>;
}
```

### 5.3 Identifiers

- Persisted IDs are UUIDs generated by application code (`crypto.randomUUID()`), never by the LLM.
- LLM stages work with short **local IDs** (`s12` for spans, `c3` for claims, `i2` for inferences). The pipeline maps local IDs to UUIDs when building the domain `ArgumentGraph`. Any local ID the model references that doesn't exist is a validation error.
- Models never produce character offsets. Spans and their offsets are computed deterministically before any LLM call; models reference span IDs only.

---

## 6. Argument model

The canonical model is in `docs/argument-model.mermaid`. Key semantics:

- **Document**: immutable Markdown source text.
- **Span**: a sentence-level segment of the document with stable ordinal and character offsets. Computed deterministically. Carries a discourse `function` label from classification.
- **AnalysisRun**: one execution of the pipeline over a document. Tracks status and stage, and emits **RunEvents** for progress.
- **Revision**: a versioned snapshot of an argument graph. In v1 every successful run produces one revision with `author: "system"`. All structural entities (claims, inferences, relations, findings) belong to a revision, so reruns never collide. Editing (later) will create child revisions.
- **Claim**: a proposition. Has `canonical_text`, `kind`, `modality`, `origin`, optional `authority` (for `legal_rule`), `confidence`, and `is_thesis`. Exactly one thesis per revision in v1.
- **Occurrence**: links a claim to a span, keeping the author's original wording (`surface_text`). Stated claims must have ≥1 occurrence; inferred claims have none.
- **Inference**: a reasoning step from one or more premise claims to one conclusion claim. Has a `scheme` and a `support` type:
  - `linked`: premises are jointly required; each premise is necessary for this step.
  - `convergent`: each premise independently supports the conclusion.
  - Multiple inferences may conclude the same claim; these are alternative routes of support.
- **InferencePremise**: join between an inference and a premise claim, with its own `origin` (an inferred premise can join a stated inference).
- **Relation**: an attack or qualification. `rebut` targets a claim's conclusion, `undermine` targets a premise claim, `undercut` targets an inference, `qualify` narrows a claim. Exactly one of `target_claim_id` / `target_inference_id` is set.
- **Finding**: an analysis result referencing claims and/or inferences. Regenerable, never mutates structure, records `produced_by` (analyzer name + version).

Roles such as "premise" and "intermediate conclusion" are **computed from graph position**, not stored.

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

The analysis layer checks entailment with a SAT solver. Deductive steps without a formalization produce `unchecked_step` (info), never `invalid_step`.

---

## 7. Phase 1 — Argument structure and validation

**Goal:** a complete, tested domain model, analysis engine, and persistence layer, usable without any LLM.

### 7.1 Scaffolding

- pnpm workspace, Turborepo pipelines (`build`, `test`, `lint`, `typecheck`), shared configs in `packages/config`.
- `docker-compose.yml` with Postgres for local development.
- `.env.example` documenting all variables (see §10).

### 7.2 `packages/domain`

- Zod schemas and inferred types for every entity in §6, plus `ArgumentGraph` (a revision's complete structure: claims, occurrences, inferences, premises, relations, findings) and `ArgumentGraphDraft` (same shape using local IDs, as produced by the pipeline).
- Branded ID types (`DocumentId`, `ClaimId`, …).
- Repository interfaces (§5.2).
- No I/O, no Drizzle, no LangChain imports.

### 7.3 `packages/analysis`

Two parts, both pure and deterministic.

**Structural validation** — `validateArgumentGraph(draft): ValidationResult` returns a list of typed, human-readable errors suitable for feeding back to an LLM. Rules include at least:

- every local ID referenced exists and is unique;
- exactly one thesis;
- every stated claim has ≥1 occurrence referencing an existing span; inferred claims have none;
- every inference has ≥1 premise and exactly one conclusion; the conclusion is not among its own premises;
- `linked` inferences have ≥2 premises;
- every relation has exactly one target;
- enum values valid; `confidence` in [0, 1];
- the thesis is reachable: it is the conclusion of at least one inference, or the graph has a single claim (degenerate argument, allowed but flagged);
- every claim other than the thesis participates in at least one inference or relation (orphan claims are errors);
- `formalization`, if present, references only premise and conclusion claims of that inference, and has one formula per premise.

**Logical analysis** — `analyzeArgumentGraph(graph): Finding[]`, composed of independent analyzers, each with a `name` and `version`:

| Analyzer | Finding | Logic |
|---|---|---|
| implicit-premise | `implicit_premise` | Every claim with `origin: "inferred"` used as a premise. Severity `warning`; `critical` if also load-bearing. |
| load-bearing | `load_bearing` | Model support as an AND/OR graph: a ground claim (concluded by no inference) is assumed supported; a claim is supported if any inference concluding it holds; a `linked` inference holds if all premises are supported; a `convergent` inference holds if any premise is supported. A claim is load-bearing if removing it leaves the thesis unsupported. Brute-force per-claim removal is acceptable (graphs are small). |
| circularity | `circularity` | Cycle detection over claim → inference → conclusion edges using graphology. Report each cycle's members. Severity `critical`. |
| unsupported-claim | `unsupported_claim` | Ground claims (no supporting inference) of kind `factual`, `causal`, or `predictive` that are load-bearing. These are what the argument asks the reader to simply accept. Severity `warning`. |
| deductive-validity | `invalid_step` / `unchecked_step` | For `deductive` inferences with a formalization: SAT-check whether premises ∧ ¬conclusion is satisfiable; if so, `invalid_step` (`critical`) with a counterexample assignment in the explanation. Deductive steps without formalization: `unchecked_step` (`info`). |

Explanations are plain English, reference claims by their canonical text, and follow the guardrails in §1.

### 7.4 `packages/persistence`

- Drizzle schema mirroring `docs/argument-model.mermaid` (snake_case columns, FKs, enum types, indexes on all FKs and on `(run_id, sequence)` for events).
- Migrations via drizzle-kit, committed to the repo.
- Mappers (`toDomain` / `toRow`) per entity; mapper unit tests for round-tripping.
- Repository implementations of every interface in §5.2. `saveArgumentGraph` is a single transaction.

### 7.5 Phase 1 acceptance criteria

- Hand-built `ArgumentGraph` fixtures in `packages/analysis/test/fixtures/` covering at least:
  - **contract notice** — rule (C1) + fact (C2) → thesis (C3), linked deductive inference, inferred premise C4 ("an email satisfies the written-notice requirement"). Expected: `implicit_premise` (critical) on C4; `load_bearing` on C1, C2, C4; `unchecked_step` or, with formalization, no `invalid_step`.
  - convergent support where no single premise is load-bearing;
  - a circular argument;
  - an invalid formalized deductive step (affirming the consequent);
  - a graph failing several validation rules.
- `pnpm test` passes; analysis coverage ≥ 90%.
- Repository integration tests round-trip a full `ArgumentGraph` through Postgres unchanged.

---

## 8. Phase 2 — LLM integration

**Goal:** a LangGraph workflow that turns pasted Markdown into a validated, analyzed, persisted `ArgumentGraph`, running in a background worker with live progress.

### 8.1 Provider abstraction (`packages/pipeline/src/llm/`)

- Define our own `ModelProvider` port: `getChatModel(stage: PipelineStage): BaseChatModel`.
- A factory builds models from configuration (`LLM_PROVIDER`, per-stage model overrides). Implement Anthropic and OpenAI now; leave Bedrock (`@langchain/aws`) and an OpenAI-compatible endpoint (for self-hosted models) as documented, easily added options.
- All structured output uses `withStructuredOutput(zodSchema)`. Stage code must never depend on provider-specific features.
- Record the provider and model used per stage in `AnalysisRun.model_config`.
- Provide a `FakeModelProvider` returning scripted structured responses, for tests.

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
| `classify` | LLM | Label each span's discourse function with confidence. Batch spans; include neighboring context. |
| gate | conditional edge | If no span is `argumentative` above a threshold, end with run status `not_an_argument` and a short summary of what the text appears to be. |
| `extract` | LLM | Produce claims (with occurrences by span ID and surface text), the thesis, inferences, and relations as an `ArgumentGraphDraft`. Stated content only. Send the whole document; do not chunk in v1. |
| `reconstruct` | LLM | Canonicalize claim text, merge duplicate claims (combining occurrences), assign `kind`/`modality`/`scheme`/`support`, add implicit premises as `origin: "inferred"`, and add formalizations for deductive rule-application steps. Must not alter or remove stated content's occurrences. |
| `validate` | deterministic | Run `validateArgumentGraph`. On errors, route back to `reconstruct` with the error list in state. Max 3 retries, then fail the run. |
| `analyze` | deterministic | Run `analyzeArgumentGraph`. |
| `persist` | I/O | Map local IDs to UUIDs; save spans, revision, and graph in one transaction via injected repositories; link revision to run. |

- State is a typed LangGraph state annotation; every node is a separately testable function.
- Use the Postgres checkpointer so a crashed run can resume.
- Prompts live in `packages/pipeline/src/prompts/` as versioned modules; each prompt states the guardrails from §1 explicitly. Record prompt versions in `model_config`.
- If the document exceeds a configurable size limit (`MAX_DOCUMENT_CHARS`), reject at submission with a clear error rather than truncating.

### 8.3 Progress feedback

- Each node emits `stage_started`, optional `stage_progress` (e.g. "classified 40 / 120 spans"), and `stage_completed` events through an injected `ProgressReporter`, which the worker implements by appending `RunEvent` rows (monotonic `sequence` per run) and updating `AnalysisRun.current_stage`.
- Validation retries emit `validation_retry` with the error count; failures emit `run_failed` with a user-safe message.
- Event payloads must be safe to show users: no raw prompts, no API keys, no stack traces.

### 8.4 Worker (`apps/worker`)

- pg-boss consumer for `analyze-document` jobs. Composition root: builds repositories, provider factory, and progress reporter, and runs the workflow.
- Handles graceful shutdown; marks runs `failed` on unrecoverable errors.

### 8.5 API (`apps/web/app/api/`)

Route handlers are thin; logic lives in server-side services that depend on repository interfaces.

| Method & path | Purpose |
|---|---|
| `POST /api/documents` | Body `{ title?, role?, sourceText }`. Validate size, create document + run, enqueue job. Returns `{ documentId, runId }`. |
| `GET /api/documents` | List documents with latest run status. |
| `GET /api/documents/:id` | Document with source text and spans. |
| `GET /api/documents/:id/argument` | Latest revision's `ArgumentGraph` with findings. |
| `GET /api/runs/:id` | Run status. |
| `GET /api/runs/:id/events` | Server-Sent Events stream of `RunEvent`s; supports `Last-Event-ID` resume; closes on terminal status. Polling the events table (≈500 ms) is acceptable in v1. |

All request and response bodies are validated with Zod schemas shared from `packages/domain` (or a `contracts` module within it).

### 8.6 Phase 2 acceptance criteria

- Unit tests for every deterministic node; pipeline tests run end-to-end with `FakeModelProvider`, including: non-argument exit, validation retry that recovers, validation retry that fails.
- An opt-in evaluation script (`pnpm eval`) runs the real pipeline over every file in `fixtures/arguments/` and writes a report (per document: status, claim/inference counts, findings by kind, validation retries, duration). It must not assume specific fixture content. It never runs in the default test suite.
- Submitting a fixture via `POST /api/documents` locally yields live SSE progress and a persisted, analyzed revision.

---

## 9. Phase 3 — UI (React, MVVM)

**Goal:** a read-only interface to submit text, watch progress, and explore the analyzed argument.

### 9.1 MVVM conventions

- **Model**: domain types from `packages/domain`, obtained through a typed API client (`apps/web/src/client/api/`). The API client is the only code that calls `fetch` or opens EventSources.
- **ViewModel**: MobX classes in `apps/web/src/viewmodels/`, one per screen or major panel. They hold observable state, expose `computed` derivations and action methods (commands), and depend on the API client via constructor injection. ViewModels contain no JSX and no DOM access.
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
  - **Inspector + findings** (right): a findings list grouped by severity, each clickable to focus the relevant elements; an inspector showing the selected element's details (canonical text, kind, modality, origin, authority, occurrences with surface text, confidence, related findings).

`ArgumentMapViewModel` computes React Flow nodes/edges and runs ELK layout; Views only render its output. Selection state is shared across panels through a screen-level `DocumentAnalysisViewModel`.

### 9.3 Visual encoding

- Inferred elements: dashed border plus an "Inferred" badge. Never rely on color alone.
- Thesis: distinct node style and label.
- Load-bearing claims: emphasized border plus an icon; critical findings shown as a badge with count.
- Claim kind shown as a text badge.
- Support types: linked inferences shown as a single inference node joining premises; convergent inferences labeled.
- Must work in light and dark modes, be keyboard navigable (select nodes, move between findings), and meet WCAG AA contrast.

### 9.4 Phase 3 acceptance criteria

- ViewModel unit tests for selection syncing, findings focus, SSE event handling (including reconnection and terminal states), and graph-to-React-Flow mapping.
- Component tests for key Views using a stub ViewModel.
- Manually verified: submitting each fixture shows live progress and a navigable map in which every stated claim highlights its source text and every inferred element is visibly marked.

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
MAX_DOCUMENT_CHARS=200000
PIPELINE_MAX_VALIDATION_RETRIES=3
```

Configuration is parsed and validated with Zod at startup in each app; fail fast on invalid config. Secrets are never logged.

---

## 11. Engineering conventions

- TypeScript strict; no `any` (use `unknown` and narrow). No non-null assertions without a comment explaining why.
- Prefer pure functions and explicit dependency injection; no module-level singletons except at composition roots.
- Errors: typed result objects (`{ ok: true, value } | { ok: false, error }`) for expected failures in domain and analysis; exceptions only for unexpected failures.
- Logging: structured JSON logs in worker and API, including `runId` and `stage`. Never log document text, prompts, or model output at info level.
- Tests sit beside the code (`*.test.ts`) or in a package `test/` directory. Every bug fix adds a regression test.
- Keep this file current: when a decision in this document changes, update it in the same change.

## 12. Working agreement for agents

- Work phase by phase. Do not start a phase until the previous phase's acceptance criteria pass.
- Before writing code that uses an external library, check its current documentation.
- If a requirement here is ambiguous or conflicts with what you find in the code, stop and ask rather than guessing.
- Do not implement anything listed as out of scope, even partially, unless asked.

## 13. Future iterations (context only — do not build)

Authentication, RBAC and user management (required before deployment); argument editing with child revisions; PDF and DOCX ingestion; evidence linking with reliability assessment; competing hypotheses over shared facts; AIF JSON export; Bedrock and self-hosted model providers; long-document chunking strategies.
