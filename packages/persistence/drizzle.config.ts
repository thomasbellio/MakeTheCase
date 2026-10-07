import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration. Migrations are generated from the schema and
 * committed to the repository (AGENTS.md section 7.4).
 *
 * `DATABASE_URL` is only needed for commands that touch a live database
 * (`migrate`, `push`, `studio`); `generate` works from the schema alone.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
