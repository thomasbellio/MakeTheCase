# Boundary rule fixtures

Each `*.boundary-fixture.ts` file in a `__boundaries__/` directory contains one
deliberately illegal import. `pnpm lint:boundaries` runs ESLint over them with
`eslint.boundaries.config.js` and requires the expected rule to fire, so the
architecture rules in AGENTS.md section 4 stay enforced instead of becoming
dead configuration.

A fixture must live inside the package whose rule it tests: the plugin derives
an element's type from its file path. These files are excluded from every
`tsconfig`, from the normal lint run, and from the test globs, so they are never
compiled, imported, or executed.
