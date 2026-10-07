import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { invokeStructured } from '../llm/structured.ts';
import { FakeModelProvider } from './fake-model-provider.ts';

const schema = z.object({ answer: z.string() });

describe('FakeModelProvider', () => {
  it("returns each stage's scripted responses in order and records the prompts", async () => {
    const fake = new FakeModelProvider({ classify: [{ answer: 'one' }, { answer: 'two' }] });
    const model = fake.getChatModel('classify');
    const messages = [new SystemMessage('system text'), new HumanMessage('user text')];

    await expect(invokeStructured(model, schema, messages, 'first')).resolves.toEqual({
      answer: 'one',
    });
    await expect(invokeStructured(model, schema, messages, 'second')).resolves.toEqual({
      answer: 'two',
    });

    expect(fake.callsFor('classify').map((call) => call.name)).toEqual(['first', 'second']);
    expect(fake.calls[0]?.text).toContain('system text');
    expect(fake.calls[0]?.text).toContain('user text');
    expect(fake.remaining('classify')).toBe(0);
  });

  it('throws a scripted error', async () => {
    const fake = new FakeModelProvider().enqueue('extract', new Error('provider down'));

    await expect(invokeStructured(fake.getChatModel('extract'), schema, [], 'x')).rejects.toThrow(
      'provider down',
    );
  });

  it("parses scripted responses through the caller's schema", async () => {
    const fake = new FakeModelProvider({ extract: [{ answer: 42 }] });

    await expect(invokeStructured(fake.getChatModel('extract'), schema, [], 'x')).rejects.toThrow();
  });

  it('fails when a stage runs out of responses', async () => {
    const fake = new FakeModelProvider();

    await expect(
      invokeStructured(fake.getChatModel('reconstruct'), schema, [], 'x'),
    ).rejects.toThrow(/no scripted response left for stage 'reconstruct'/);
  });
});
