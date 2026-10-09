import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeModelProvider, malformed } from '../testing/fake-model-provider.ts';
import { invokeStructured, StructuredOutputError } from './structured.ts';

const schema = z.object({
  claims: z.array(z.object({ id: z.string() })),
  inferences: z.array(z.object({ id: z.string() })),
});

describe('invokeStructured', () => {
  it('repairs malformed output without another call', async () => {
    const fake = new FakeModelProvider({
      reconstruct: [malformed({ claims: '[{"id":"c1"}],"inferences":[]' })],
    });

    await expect(
      invokeStructured(fake.getChatModel('reconstruct'), schema, [], 'x'),
    ).resolves.toEqual({
      claims: [{ id: 'c1' }],
      inferences: [],
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('asks again when output cannot be repaired', async () => {
    const fake = new FakeModelProvider({
      reconstruct: [malformed({ claims: 'nonsense' }), { claims: [], inferences: [] }],
    });

    await expect(
      invokeStructured(fake.getChatModel('reconstruct'), schema, [], 'x'),
    ).resolves.toEqual({
      claims: [],
      inferences: [],
    });
    expect(fake.calls).toHaveLength(2);
  });

  it('recovers a response whose damage carries the closing brace', async () => {
    // The shape that used to lose the whole response: wrapping it produced
    // `{...}}`, which does not parse.
    const fake = new FakeModelProvider({
      reconstruct: [malformed({ claims: '[{"id":"c1"}],"inferences":[]}' })],
    });

    await expect(
      invokeStructured(fake.getChatModel('reconstruct'), schema, [], 'x'),
    ).resolves.toEqual({ claims: [{ id: 'c1' }], inferences: [] });
    expect(fake.calls).toHaveLength(1);
  });

  it('tells the model what was wrong when asking again', async () => {
    // Asking again identically invites the same answer, which is why a
    // deterministic malformation used to fail all three attempts.
    const fake = new FakeModelProvider({
      reconstruct: [malformed({ claims: 'nonsense' }), { claims: [], inferences: [] }],
    });

    await invokeStructured(fake.getChatModel('reconstruct'), schema, [], 'x');

    const calls = fake.callsFor('reconstruct');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).not.toContain('could not be read');
    expect(calls[1]?.text).toContain('could not be read');
    // Schema paths, so the model knows what to fix.
    expect(calls[1]?.text).toContain('claims');
  });

  it('never quotes the model\u2019s own output back to it', async () => {
    const secret = '[{"id":"confidential document text"';
    const fake = new FakeModelProvider({
      reconstruct: [malformed({ claims: secret }), { claims: [], inferences: [] }],
    });

    await invokeStructured(fake.getChatModel('reconstruct'), schema, [], 'x');

    const retry = fake.callsFor('reconstruct')[1]?.text ?? '';
    expect(retry).not.toContain('confidential document text');
  });

  it('tells the model to be briefer when its output was cut short', async () => {
    const cut = { claims: '[{"id":"c1"},{"id":' };
    const fake = new FakeModelProvider({
      reconstruct: [malformed(cut), { claims: [], inferences: [] }],
    });

    await invokeStructured(fake.getChatModel('reconstruct'), schema, [], 'x');

    expect(fake.callsFor('reconstruct')[1]?.text).toMatch(/too long|concisely/);
  });

  it('says when the output was cut short, because that needs a different fix', async () => {
    const cut = { claims: '[{"id":"c1"},{"id":' };
    const fake = new FakeModelProvider({
      reconstruct: [malformed(cut), malformed(cut), malformed(cut)],
    });

    const failure = invokeStructured(
      fake.getChatModel('reconstruct'),
      schema,
      [],
      'reconstruct_argument',
    );

    // Truncation means the response did not fit the output budget; no amount of
    // schema or prompt tightening fixes that.
    await expect(failure).rejects.toThrow(/cut short/);
  });

  it('gives up after three attempts, naming schema paths but not the output', async () => {
    const secret = 'confidential document text';
    const fake = new FakeModelProvider({
      reconstruct: [
        malformed({ claims: secret }),
        malformed({ claims: secret }),
        malformed({ claims: secret }),
      ],
    });

    const failure = invokeStructured(
      fake.getChatModel('reconstruct'),
      schema,
      [],
      'reconstruct_argument',
    );

    await expect(failure).rejects.toBeInstanceOf(StructuredOutputError);
    await expect(failure).rejects.toThrow(/reconstruct_argument: .* after 3 attempts \(claims: /);
    await expect(failure).rejects.not.toThrow(secret);
  });
});
