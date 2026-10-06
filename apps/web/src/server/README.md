# Server-side code

The composition root for the API. Code here may import
`@make-your-case/persistence`, `@make-your-case/domain` and `pg-boss`
(AGENTS.md section 4).

Phase 2 adds the services that route handlers in `src/app/api/` delegate to.
Route handlers stay thin so authentication middleware can be added in one place
later (AGENTS.md section 2).
