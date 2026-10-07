import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { draftSpanSchema } from '@make-your-case/domain';
import { describe, expect, it } from 'vitest';
import { segmentDocument } from './segment.ts';

const fixturesDir = fileURLToPath(new URL('../../../../fixtures/arguments/', import.meta.url));
const fixtures = readdirSync(fixturesDir).filter((name) => name.endsWith('.md'));

const texts = (source: string) => segmentDocument(source).map((segmented) => segmented.text);

describe('segmentDocument', () => {
  it.each(fixtures)('produces valid, ordered, non-overlapping spans for %s', (name) => {
    const source = readFileSync(`${fixturesDir}${name}`, 'utf8');
    const spans = segmentDocument(source);

    expect(spans.length).toBeGreaterThan(0);
    let previousEnd = 0;
    spans.forEach(({ span, text }, index) => {
      expect(draftSpanSchema.parse(span)).toEqual(span);
      expect(span.ordinal).toBe(index);
      expect(span.id).toBe(`s${String(index + 1)}`);
      expect(source.slice(span.char_start, span.char_end)).toBe(text);
      expect(text).toBe(text.trim());
      expect(text.length).toBeGreaterThan(0);
      expect(span.char_start).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = span.char_end;
    });
  });

  it('is deterministic', () => {
    const source = readFileSync(`${fixturesDir}14-long-brief.md`, 'utf8');
    expect(segmentDocument(source)).toEqual(segmentDocument(source));
  });

  it('keeps each heading as one span, without its markers', () => {
    const spans = segmentDocument(
      '## I. The Department’s silence was a denial ##\n\nIt said nothing. So it denied.',
    );

    expect(spans.map((s) => [s.text, s.span.is_heading, s.headingDepth])).toEqual([
      ['I. The Department’s silence was a denial', true, 2],
      ['It said nothing.', false, null],
      ['So it denied.', false, null],
    ]);
  });

  it('excludes list markers from offsets but keeps them on the first span of each item', () => {
    const spans = segmentDocument(
      '17. The notice arrived. It was signed.\n18. The sign was approved.\n\n- A bullet.',
    );

    expect(spans.map((s) => [s.text, s.listMarker])).toEqual([
      ['The notice arrived.', '17.'],
      ['It was signed.', null],
      ['The sign was approved.', '18.'],
      ['A bullet.', '-'],
    ]);
  });

  it('keeps inline markup inside the span and skips code blocks and rules', () => {
    expect(
      texts('The term is **void**.\n\n```\nnot prose.\n```\n\n---\n\n> Quoted text here.'),
    ).toEqual(['The term is **void**.', 'Quoted text here.']);
  });

  it.each([
    [
      'a case name',
      'See Smith v. Jones, 123 F.3d 456 (9th Cir. 1999). The court disagreed.',
      ['See Smith v. Jones, 123 F.3d 456 (9th Cir. 1999).', 'The court disagreed.'],
    ],
    [
      'a statute and a record cite',
      'Under Lab. Code § 22, the employer must pay. Okafor Decl. ¶ 3. The record (R. at 15) agrees.',
      [
        'Under Lab. Code § 22, the employer must pay.',
        'Okafor Decl. ¶ 3.',
        'The record (R. at 15) agrees.',
      ],
    ],
    [
      'initials, entities and dates',
      'The U.S. Supreme Court agreed. Acme Inc. filed on Jan. 5. Mr. Smith testified. See Ex. B at 4.',
      [
        'The U.S. Supreme Court agreed.',
        'Acme Inc. filed on Jan. 5.',
        'Mr. Smith testified.',
        'See Ex. B at 4.',
      ],
    ],
    [
      'an id. citation',
      'The court so held. Id. at 5. The rule is settled.',
      ['The court so held.', 'Id. at 5.', 'The rule is settled.'],
    ],
  ])('does not split inside %s', (_label, source, expected) => {
    expect(texts(source)).toEqual(expected);
  });
});
