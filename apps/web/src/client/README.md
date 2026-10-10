# Client-side code

The typed API client, MobX ViewModels and React Views. Code here may import
**only** domain types from `@make-your-case/domain`, never `persistence`,
`pipeline`, or any server-only module (AGENTS.md section 4).

- `api/` — `HttpApiClient`, the only code that calls `fetch` or opens an `EventSource`; `testing/` holds `FakeApiClient`.
- `model/` — pure derivations over domain types: the argument index, selection highlighting, the stage timeline, the argument map.
- `viewmodels/` — one MobX class per screen or panel; no JSX, no DOM.
- `views/` — `observer` components that render ViewModel state and call its commands.
- `testing/` — a sample revision shared by the tests.
