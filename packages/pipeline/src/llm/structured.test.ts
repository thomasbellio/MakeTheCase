import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeModelProvider, malformed } from '../testing/fake-model-provider.ts';
import { invokeStructured, repairStringifiedFields, StructuredOutputError } from './structured.ts';

const schema = z.object({
  claims: z.array(z.object({ id: z.string() })),
  inferences: z.array(z.object({ id: z.string() })),
});

describe('repairStringifiedFields', () => {
  it('re-parses a field holding the rest of the object as JSON text', () => {
    // The shape Haiku produced on a large reconstruct response.
    const args = { claims: '[{"id":"c1"}],"inferences":[{"id":"i1"}]' };

    expect(repairStringifiedFields(args)).toEqual({
      claims: [{ id: 'c1' }],
      inferences: [{ id: 'i1' }],
    });
  });

  it('re-parses a field holding only its own value', () => {
    expect(repairStringifiedFields({ claims: '[{"id":"c1"}]', inferences: [] })).toEqual({
      claims: [{ id: 'c1' }],
      inferences: [],
    });
  });

  it('leaves ordinary strings and unparseable text alone', () => {
    const args = { text: 'plain', claims: '[not json' };
    expect(repairStringifiedFields(args)).toEqual(args);
  });
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
