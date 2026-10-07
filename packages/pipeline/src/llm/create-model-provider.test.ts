import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { describe, expect, it } from 'vitest';
import { createModelProvider } from './create-model-provider.ts';

const provider = createModelProvider({
  classify: { provider: 'openai', model: 'gpt-small', apiKey: 'sk-openai-secret' },
  reconstruct: { provider: 'anthropic', model: 'claude-big', apiKey: 'sk-ant-secret' },
});

describe('createModelProvider', () => {
  it("builds each stage's model from its own provider and model", () => {
    const classify = provider.getChatModel('classify');
    const reconstruct = provider.getChatModel('reconstruct');

    expect(classify).toBeInstanceOf(ChatOpenAI);
    expect((classify as ChatOpenAI).model).toBe('gpt-small');
    expect(reconstruct).toBeInstanceOf(ChatAnthropic);
    expect((reconstruct as ChatAnthropic).model).toBe('claude-big');
  });

  it('builds each model once', () => {
    expect(provider.getChatModel('classify')).toBe(provider.getChatModel('classify'));
  });

  it('refuses a stage that was not configured', () => {
    expect(() => provider.getChatModel('judge')).toThrow(/judge/);
  });

  it('describes the configuration without secrets', () => {
    const description = provider.describe();

    expect(description).toEqual({
      classify: { provider: 'openai', model: 'gpt-small' },
      reconstruct: { provider: 'anthropic', model: 'claude-big' },
    });
    expect(JSON.stringify(description)).not.toMatch(/secret/);
  });
});
