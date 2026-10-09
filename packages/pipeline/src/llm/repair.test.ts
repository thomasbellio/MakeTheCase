import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { looksTruncated, parseJsonLoose, repairCandidates } from './repair.ts';

/**
 * The schema stands in for a reconstruct response: a few top-level arrays,
 * which is the shape that provokes the damage.
 */
const schema = z.object({
  claims: z.array(z.object({ id: z.string() })),
  inferences: z.array(z.object({ id: z.string() })),
  relations: z.array(z.object({ id: z.string() })),
});

/** What `invokeStructured` does: first candidate that validates wins. */
function recover(raw: unknown): z.infer<typeof schema> | undefined {
  for (const candidate of repairCandidates(raw)) {
    const result = schema.safeParse(candidate.value);
    if (result.success) return result.data;
  }
  return undefined;
}

const expected = {
  claims: [{ id: 'c1' }, { id: 'c2' }],
  inferences: [{ id: 'i1' }],
  relations: [],
};

describe('recovering a damaged structured response', () => {
  it('passes through output that is already correct', () => {
    expect(recover(expected)).toEqual(expected);
  });

  it('recovers a field holding only its own value', () => {
    expect(
      recover({ claims: '[{"id":"c1"},{"id":"c2"}]', inferences: [{ id: 'i1' }], relations: [] }),
    ).toEqual(expected);
  });

  it('recovers a field holding the object’s remaining fields too', () => {
    // The shape the original repair was written for.
    expect(
      recover({ claims: '[{"id":"c1"},{"id":"c2"}],"inferences":[{"id":"i1"}],"relations":[]' }),
    ).toEqual(expected);
  });

  it('recovers when the remainder carries the closing brace as well', () => {
    // Not handled before: wrapping this produced `{...}}` and failed to parse,
    // losing the whole response.
    expect(
      recover({ claims: '[{"id":"c1"},{"id":"c2"}],"inferences":[{"id":"i1"}],"relations":[]}' }),
    ).toEqual(expected);
  });

  it('recovers when a trailing comma is left behind', () => {
    expect(
      recover({ claims: '[{"id":"c1"},{"id":"c2"}],', inferences: [{ id: 'i1' }], relations: [] }),
    ).toEqual(expected);
  });

  it('recovers when the whole response arrived as text', () => {
    expect(recover(JSON.stringify(expected))).toEqual(expected);
  });

  it('recovers when a field holds the whole response as text', () => {
    expect(recover({ claims: JSON.stringify(expected) })).toEqual(expected);
  });

  it('recovers a later field being the damaged one', () => {
    // Observed on one attempt: `inferences`, not `claims`, was the string.
    expect(
      recover({
        claims: [{ id: 'c1' }, { id: 'c2' }],
        inferences: '[{"id":"i1"}],"relations":[]',
      }),
    ).toEqual(expected);
  });

  it('salvages a truncated response by dropping the incomplete element', () => {
    // Losing the last claim is recoverable: validation then complains about
    // something specific and the retry loop can act on it. An unparseable
    // response loses the entire run.
    const salvaged = recover({
      claims: '[{"id":"c1"},{"id":"c2"},{"id":',
      inferences: [{ id: 'i1' }],
      relations: [],
    });

    expect(salvaged?.claims).toEqual([{ id: 'c1' }, { id: 'c2' }]);
  });

  it('gives up on text that is not JSON at all', () => {
    expect(recover({ claims: 'I cannot complete this request.' })).toBeUndefined();
  });

  it('gives up rather than inventing missing fields', () => {
    // `inferences` and `relations` are genuinely absent; no reading supplies them.
    expect(recover({ claims: '[{"id":"c1"}]' })).toBeUndefined();
  });
});

describe('parseJsonLoose', () => {
  it('reports whether a value had to be truncated to parse', () => {
    expect(parseJsonLoose('[{"a":1}]')).toEqual({ value: [{ a: 1 }], truncated: false });
    expect(parseJsonLoose('[{"a":1},{"b":')).toEqual({ value: [{ a: 1 }], truncated: true });
  });

  it('keeps as much of a truncated response as it can', () => {
    const parsed = parseJsonLoose('[{"a":1},{"a":2},{"a":3},{"a":');
    expect(parsed?.value).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('is not fooled by brackets inside strings', () => {
    const parsed = parseJsonLoose('[{"text":"a [bracket] and a \\"quote\\""}]');
    expect(parsed).toEqual({ value: [{ text: 'a [bracket] and a "quote"' }], truncated: false });
  });

  it('returns undefined for text with no recoverable JSON', () => {
    expect(parseJsonLoose('not json at all')).toBeUndefined();
  });
});

describe('looksTruncated', () => {
  it.each([
    ['[{"a":1}]', false],
    ['{"a":1}', false],
    ['[{"a":1},{"b":', true],
    ['[{"a":"unterminated', true],
    ['[{"text":"a ] inside a string"}]', false],
  ])('%s -> %s', (text, truncated) => {
    expect(looksTruncated(text)).toBe(truncated);
  });
});

describe('ordering', () => {
  it('offers at least one lossless reading before any truncated salvage', () => {
    // `invokeStructured` relies on this: it exhausts lossless candidates before
    // accepting one that dropped data.
    const candidates = repairCandidates({
      claims: '[{"id":"c1"}],"inferences":[{"id":"i1"}],"relations":[]',
    });

    expect(candidates.some((c) => !c.truncated)).toBe(true);
  });

  it('marks a salvaged candidate as truncated so callers can rank it last', () => {
    const candidates = repairCandidates({ claims: '[{"id":"c1"},{"id":' });
    const salvaged = candidates.filter((c) => c.truncated);

    expect(salvaged.length).toBeGreaterThan(0);
  });
});
