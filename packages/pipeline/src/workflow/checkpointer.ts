import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

/** Kept apart from the application's tables, which `persistence` owns and migrates. */
export const CHECKPOINT_SCHEMA = 'langgraph';

/**
 * The Postgres checkpointer that lets a crashed run resume (AGENTS.md section
 * 8.2). Creates its tables on first use. Lives in `pipeline` so the worker,
 * which composes it, never imports LangChain directly. Call `end()` on shutdown.
 */
export async function createPostgresCheckpointer(connectionString: string): Promise<PostgresSaver> {
  const checkpointer = PostgresSaver.fromConnString(connectionString, {
    schema: CHECKPOINT_SCHEMA,
  });
  await checkpointer.setup();
  return checkpointer;
}
