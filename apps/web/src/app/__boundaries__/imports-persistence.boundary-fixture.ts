// ILLEGAL BY DESIGN - see scripts/check-boundaries.mjs
// App Router files reach persistence only through `src/server`, so route
// handlers stay thin and auth can be added in one place (AGENTS.md section 2).
import '@make-your-case/persistence';
