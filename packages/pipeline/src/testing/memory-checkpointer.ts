import { MemorySaver } from '@langchain/langgraph';
import type { WorkflowDeps } from '../workflow/graph.ts';

/**
 * An in-memory checkpointer, for tests and for runs that have no need to
 * resume.
 *
 * Offered here so a consumer does not need its own LangGraph dependency to get
 * one: AGENTS.md section 4 gives `apps/worker` no such dependency, and the
 * worker's tests still need a checkpointer to build a workflow.
 */
export function createMemoryCheckpointer(): WorkflowDeps['checkpointer'] {
  return new MemorySaver();
}
