import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage, BaseMessageLike } from '@langchain/core/messages';
import type { z } from 'zod';

/** Calls per structured request before giving up on malformed output. */
export const STRUCTURED_OUTPUT_ATTEMPTS = 3;

/**
 * Thrown when a model's output still does not match the schema after every
 * attempt. The message names schema paths only: model output can echo
 * document text, which must never reach a log at info level (AGENTS.md
 * section 11).
 */
export class StructuredOutputError extends Error {
  override readonly name = 'StructuredOutputError';
}

/**
 * The only way stage code calls a model: one structured response, validated
 * against `schema`. `name` becomes the tool or schema name the provider sees.
 *
 * Models sometimes return output that fails the schema; the common case on
 * large nested responses is a field whose value is the rest of the object
 * serialized as a JSON string. The raw response is requested alongside the
 * parsed one so such output can be repaired rather than thrown away, and the
 * request is repeated when repair fails.
 */
export async function invokeStructured<Schema extends z.ZodType<Record<string, unknown>>>(
  model: BaseChatModel,
  schema: Schema,
  messages: readonly BaseMessageLike[],
  name: string,
): Promise<z.infer<Schema>> {
  const runnable = model.withStructuredOutput<z.infer<Schema>>(schema, { name, includeRaw: true });
  let problem = 'no output';

  for (let attempt = 1; attempt <= STRUCTURED_OUTPUT_ATTEMPTS; attempt++) {
    const { raw, parsed } = (await runnable.invoke([...messages])) as {
      raw: BaseMessage;
      parsed: z.infer<Schema> | null;
    };
    if (parsed !== null) return parsed;

    const repaired = schema.safeParse(repairStringifiedFields(rawArguments(raw)));
    if (repaired.success) return repaired.data;
    problem = repaired.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
  }

  throw new StructuredOutputError(
    `${name}: the model's output did not match the schema after ${String(STRUCTURED_OUTPUT_ATTEMPTS)} attempts (${problem})`,
  );
}

/** The structured arguments in a raw response: a tool call's args, or JSON message content. */
export function rawArguments(raw: BaseMessage): unknown {
  const toolCall = (raw as { tool_calls?: { args?: unknown }[] }).tool_calls?.[0];
  if (toolCall?.args !== undefined) return toolCall.args;

  const content = raw.content;
  const text =
    typeof content === 'string'
      ? content
      : content
          .map((block) => (block.type === 'text' && 'text' in block ? String(block.text) : ''))
          .join('');
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Undoes the commonest malformation: a top-level field whose value is JSON
 * text instead of JSON. The string may hold just that field's value, or that
 * value followed by the object's remaining fields (`[...], "inferences": [...]`),
 * so it is parsed back in the context of the object it was cut from.
 */
export function repairStringifiedFields(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;

  let repaired: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (typeof field !== 'string' || !/^\s*[[{]/.test(field)) continue;
    const parsed = parseObjectText(`{${JSON.stringify(key)}:${field}}`);
    if (parsed !== undefined) repaired = { ...repaired, ...parsed };
  }
  return repaired;
}

function parseObjectText(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
