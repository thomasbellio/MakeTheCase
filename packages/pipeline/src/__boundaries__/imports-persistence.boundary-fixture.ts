// ILLEGAL BY DESIGN - see scripts/check-boundaries.mjs
// pipeline must not import persistence; repositories are injected by the
// composition root in apps/worker (AGENTS.md section 4).
import '@make-your-case/persistence';
