// ILLEGAL BY DESIGN - see scripts/check-boundaries.mjs
// persistence depends on domain and drizzle only; the pipeline is a consumer of
// repositories, never the other way round (AGENTS.md section 4).
import '@make-your-case/pipeline';
