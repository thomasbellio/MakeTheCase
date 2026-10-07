import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessageLike } from '@langchain/core/messages';
import type { z } from 'zod';

/**
 * The only way stage code calls a model: one structured response, validated
 * against `schema`. `name` becomes the tool or schema name the provider sees.
 */
export async function invokeStructured<Schema extends z.ZodType<Record<string, unknown>>>(
  model: BaseChatModel,
  schema: Schema,
  messages: readonly BaseMessageLike[],
  name: string,
): Promise<z.infer<Schema>> {
  const runnable = model.withStructuredOutput<z.infer<Schema>>(schema, { name });
  return runnable.invoke([...messages]);
}
