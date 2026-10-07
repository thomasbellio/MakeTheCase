import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';
import { describeLlmConfig, PIPELINE_LLM_STAGES, resolveLlmConfig } from './llm.ts';

const base = {
  DATABASE_URL: 'postgres://user:pw@localhost:5432/db',
  ANTHROPIC_API_KEY: 'sk-ant-secret',
  LLM_MODEL_DEFAULT: 'claude-default',
};

describe('resolveLlmConfig', () => {
  it('applies the global provider and default model to every stage', () => {
    const result = resolveLlmConfig(parseEnv(base), PIPELINE_LLM_STAGES);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const stage of PIPELINE_LLM_STAGES) {
      expect(result.value[stage]).toEqual({
        provider: 'anthropic',
        model: 'claude-default',
        apiKey: 'sk-ant-secret',
      });
    }
    expect(result.value.judge).toBeUndefined();
  });

  it('lets a stage override the provider and model', () => {
    const env = parseEnv({
      ...base,
      OPENAI_API_KEY: 'sk-openai-secret',
      LLM_MODEL_RECONSTRUCT: 'claude-big',
      LLM_PROVIDER_JUDGE: 'openai',
      LLM_MODEL_JUDGE: 'gpt-judge',
    });
    const result = resolveLlmConfig(env, ['classify', 'reconstruct', 'judge']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classify?.model).toBe('claude-default');
    expect(result.value.reconstruct?.model).toBe('claude-big');
    expect(result.value.judge).toEqual({
      provider: 'openai',
      model: 'gpt-judge',
      apiKey: 'sk-openai-secret',
    });
  });

  it('reports a missing model for each stage that has none', () => {
    const env = parseEnv({ ...base, LLM_MODEL_DEFAULT: '', LLM_MODEL_EXTRACT: 'claude-x' });
    const result = resolveLlmConfig(env, PIPELINE_LLM_STAGES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join('\n')).toMatch(/classify: no model.*LLM_MODEL_CLASSIFY/);
    expect(result.errors.join('\n')).toMatch(/reconstruct: no model.*LLM_MODEL_RECONSTRUCT/);
  });

  it("reports a missing key for the stage's resolved provider", () => {
    const env = parseEnv({ ...base, LLM_PROVIDER_CLASSIFY: 'openai' });
    const result = resolveLlmConfig(env, PIPELINE_LLM_STAGES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(["classify: provider 'openai' requires OPENAI_API_KEY"]);
  });

  it('treats blank overrides from .env.example as unset', () => {
    const env = parseEnv({ ...base, LLM_PROVIDER_EXTRACT: '', LLM_MODEL_EXTRACT: '' });
    const result = resolveLlmConfig(env, ['extract']);

    expect(result.ok && result.value.extract?.model).toBe('claude-default');
  });

  it('never puts a secret in an error or a description', () => {
    const env = parseEnv({ ...base, LLM_MODEL_DEFAULT: '' });
    const failed = resolveLlmConfig(env, PIPELINE_LLM_STAGES);
    expect(JSON.stringify(failed)).not.toContain('sk-ant-secret');

    const resolved = resolveLlmConfig(parseEnv(base), PIPELINE_LLM_STAGES);
    if (!resolved.ok) throw new Error('expected config to resolve');
    expect(JSON.stringify(describeLlmConfig(resolved.value))).not.toContain('sk-ant-secret');
    expect(describeLlmConfig(resolved.value).extract).toEqual({
      provider: 'anthropic',
      model: 'claude-default',
    });
  });
});
