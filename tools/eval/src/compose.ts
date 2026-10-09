import { MemorySaver } from '@langchain/langgraph';
import {
  PIPELINE_LLM_STAGES,
  parseEnv,
  resolveLlmConfig,
  type Env,
  type LlmStage,
  type Repositories,
} from '@make-your-case/domain';
import { createModelProvider, type ModelProvider } from '@make-your-case/pipeline';
import { createDb, createRepositories } from '@make-your-case/persistence';

/**
 * The evaluation harness's composition root (AGENTS.md section 4): it owns the
 * database handle, the repositories and the model provider, and hands them to
 * the workflow.
 */

export interface Harness {
  readonly env: Env;
  readonly repositories: Repositories;
  readonly models: ModelProvider;
  /**
   * In memory, not Postgres. Every fixture is a fresh run, so resume never
   * fires, and the Postgres checkpointer is already covered by the pipeline's
   * own `test:db`. Using it here would only accumulate rows in the `langgraph`
   * schema.
   */
  readonly newCheckpointer: () => MemorySaver;
  /** Fails fast if migrations have not been applied, which is the usual first-run trip. */
  assertSchemaReady: () => Promise<void>;
  close: () => Promise<void>;
}

export interface HarnessOptions {
  readonly databaseUrl?: string | undefined;
  /** When false the judge stage is not resolved, so no judge model is needed. */
  readonly judge: boolean;
}

/** Thrown for a configuration problem, with every problem listed at once. */
export class ConfigurationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`the harness is not configured:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    this.name = 'ConfigurationError';
    this.problems = problems;
  }
}

export function createHarness(options: HarnessOptions): Harness {
  // The override goes through the same schema as everything else, so a bad URL
  // fails the same way and no secret is echoed (section 10).
  const source =
    options.databaseUrl === undefined
      ? process.env
      : { ...process.env, DATABASE_URL: options.databaseUrl };

  let env: Env;
  try {
    env = parseEnv(source);
  } catch (error) {
    throw new ConfigurationError([(error as Error).message]);
  }

  const stages: LlmStage[] = options.judge
    ? [...PIPELINE_LLM_STAGES, 'judge']
    : [...PIPELINE_LLM_STAGES];
  const llm = resolveLlmConfig(env, stages);
  if (!llm.ok) {
    // Reported before anything is spent.
    throw new ConfigurationError(llm.errors);
  }

  const { db, close } = createDb(env.DATABASE_URL);

  return {
    async assertSchemaReady(): Promise<void> {
      try {
        await db.execute('select 1 from "document" limit 0');
      } catch {
        throw new ConfigurationError([
          'the database has no schema. Run `pnpm db:up` and then `pnpm db:migrate`.',
        ]);
      }
    },
    env,
    repositories: createRepositories(db),
    models: createModelProvider(llm.value),
    newCheckpointer: () => new MemorySaver(),
    close,
  };
}
