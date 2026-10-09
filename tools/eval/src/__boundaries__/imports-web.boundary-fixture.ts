// ILLEGAL BY DESIGN - see scripts/check-boundaries.mjs
// No package may import from an apps/* package, including the evaluation
// harness, which is a composition root of its own (AGENTS.md section 4).
import '@make-your-case/web';
