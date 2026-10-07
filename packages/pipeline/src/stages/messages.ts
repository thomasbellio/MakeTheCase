import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { Prompt } from '../prompts/prompt.ts';

export function promptMessages<Input>(prompt: Prompt<Input>, input: Input): BaseMessage[] {
  return [new SystemMessage(prompt.system), new HumanMessage(prompt.render(input))];
}
