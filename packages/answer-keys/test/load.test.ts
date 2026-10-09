import { describe, expect, it } from 'vitest';
import { loadAnswerKey, loadAnswerKeys, parseAnswerKey, resolveFixtureStem } from '../src/load.ts';
import { softLeaves } from '../src/schema.ts';

describe('the real fixtures', () => {
  it('all parse against the schema', async () => {
    // The check that keeps the schema and the fixtures honest. It runs in the
    // unit suite, so a fixture that the harness could not read fails long
    // before any model is called.
    const cases = await loadAnswerKeys();
    expect(cases).toHaveLength(14);
  });

  it('pairs every markdown file with a key of the same stem', async () => {
    for (const fixture of await loadAnswerKeys()) {
      expect(fixture.key.id).toBe(fixture.stem);
      expect(fixture.sourceText.length).toBeGreaterThan(0);
    }
  });

  it('expects exactly two non-argument fixtures', async () => {
    const cases = await loadAnswerKeys();
    const nonArguments = cases.filter((c) => c.key.expected_status === 'not_an_argument');
    expect(nonArguments.map((c) => c.stem)).toEqual(['11-narrative-only', '12-instructional']);
  });

  it('accepts the one fixture that groups its soft expectations', async () => {
    // Fixture 14 nests six behaviours under `embedded_behaviors`; the schema
    // allows it and the judge grades each leaf by its dotted path.
    const { key } = await loadAnswerKey('14-long-brief');
    const paths = softLeaves(key.soft).map((leaf) => leaf.path);

    expect(paths).toContain('embedded_behaviors.alternative_routes');
    expect(paths).toContain('embedded_behaviors.implicit_premise');
    expect(paths).not.toContain('embedded_behaviors');
  });
});

describe('parseAnswerKey', () => {
  const valid = `
id: 99-example
purpose: An example
expected_status: completed
thesis: Something follows
`;

  it('applies defaults for an absent hard and soft block', () => {
    const key = parseAnswerKey('99-example', valid);
    expect(key.hard).toEqual({});
    expect(key.soft).toEqual({});
  });

  it('rejects an unknown key under hard, naming it', () => {
    expect(() =>
      parseAnswerKey('99-example', `${valid}\nhard:\n  claim_counts: { min: 1 }\n`),
    ).toThrow(/claim_counts|unrecognized/i);
  });

  it('rejects an id that does not match the file stem', () => {
    expect(() => parseAnswerKey('98-other', valid)).toThrow(/must match the file stem/);
  });

  it('rejects an unknown expected_status', () => {
    expect(() => parseAnswerKey('99-example', valid.replace('completed', 'maybe'))).toThrow(
      /expected_status/,
    );
  });
});

describe('resolveFixtureStem', () => {
  it('resolves a numeric selector', async () => {
    expect(await resolveFixtureStem('05')).toBe('05-contract-notice');
  });

  it('resolves a full stem', async () => {
    expect(await resolveFixtureStem('06-circular')).toBe('06-circular');
  });

  it('reports a selector that matches nothing', async () => {
    await expect(resolveFixtureStem('99')).rejects.toThrow(/no fixture matches/);
  });
});
