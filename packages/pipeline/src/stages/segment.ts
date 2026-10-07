import type { Heading, ListItem, Nodes, Paragraph } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { localId, type DraftSpan } from '@make-your-case/domain';

/**
 * A span plus the structural context segmentation saw but the domain `Span`
 * does not store. The context is used only to render the document for the
 * models: a list item's marker ("17.") is excluded from the span's offsets,
 * yet extraction needs it to resolve cross-references such as "Undisputed
 * Fact ¶ 17" (AGENTS.md section 8.2).
 */
export interface SegmentedSpan {
  readonly span: DraftSpan;
  /** The text at the span's offsets, exactly as in the source. */
  readonly text: string;
  /** The list marker ("17.", "-") on the first span of a list item; otherwise null. */
  readonly listMarker: string | null;
  /** Heading depth (1 for `#`) on heading spans; otherwise null. */
  readonly headingDepth: number | null;
}

/**
 * Splits a Markdown document into sentence-level spans (AGENTS.md section
 * 8.2, `segment`). Deterministic: the same text always yields the same spans.
 *
 * Offsets index the original source text. Pure formatting is excluded — the
 * `#` of a heading and the bullet or number of a list item — but inline markup
 * such as emphasis stays inside the span it belongs to. Each heading is one
 * span; paragraphs are split into sentences with `Intl.Segmenter`, then
 * repaired where it splits inside a citation ("Smith v. | Jones").
 * Code blocks, HTML and thematic breaks produce no spans.
 */
export function segmentDocument(source: string): SegmentedSpan[] {
  const tree = unified().use(remarkParse).parse(source);
  const ranges: {
    start: number;
    end: number;
    listMarker: string | null;
    headingDepth: number | null;
  }[] = [];

  function visit(node: Nodes, listMarker: string | null): void {
    switch (node.type) {
      case 'heading': {
        const range = contentRange(node);
        if (range !== null) ranges.push({ ...range, listMarker, headingDepth: node.depth });
        return;
      }
      case 'paragraph': {
        const range = contentRange(node);
        if (range === null) return;
        sentenceRanges(source, range.start, range.end).forEach((sentence, index) => {
          // Only the item's first sentence carries the marker.
          ranges.push({
            ...sentence,
            listMarker: index === 0 ? listMarker : null,
            headingDepth: null,
          });
        });
        return;
      }
      case 'listItem': {
        let marker = itemMarker(source, node);
        for (const child of node.children) {
          visit(child, marker);
          marker = null;
        }
        return;
      }
      default:
        if ('children' in node) {
          for (const child of node.children) visit(child, null);
        }
    }
  }
  visit(tree, null);

  return ranges.map((range, ordinal) => ({
    span: {
      id: localId(`s${String(ordinal + 1)}`),
      ordinal,
      char_start: range.start,
      char_end: range.end,
      is_heading: range.headingDepth !== null,
      function: 'unclassified',
      function_confidence: null,
    },
    text: source.slice(range.start, range.end),
    listMarker: range.listMarker,
    headingDepth: range.headingDepth,
  }));
}

/** From the first child's start to the last child's end, which excludes a heading's `#` markers. */
function contentRange(node: Heading | Paragraph): { start: number; end: number } | null {
  const start = node.children[0]?.position?.start.offset;
  const end = node.children[node.children.length - 1]?.position?.end.offset;
  return start === undefined || end === undefined || end <= start ? null : { start, end };
}

/** The source text between a list item's start and its first child: "17.", "-", "*". */
function itemMarker(source: string, item: ListItem): string | null {
  const start = item.position?.start.offset;
  const contentStart = item.children[0]?.position?.start.offset;
  if (start === undefined || contentStart === undefined) return null;
  const marker = source.slice(start, contentStart).trim();
  return marker === '' ? null : marker;
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

function sentenceRanges(
  source: string,
  start: number,
  end: number,
): { start: number; end: number }[] {
  const block = source.slice(start, end);
  const pieces: { start: number; end: number }[] = [];

  for (const { segment, index } of segmenter.segment(block)) {
    const trimmedStart = segment.length - segment.trimStart().length;
    const trimmedEnd = segment.trimEnd().length;
    if (trimmedEnd <= trimmedStart) continue;

    const piece = { start: start + index + trimmedStart, end: start + index + trimmedEnd };
    const previous = pieces[pieces.length - 1];
    if (
      previous !== undefined &&
      continuesSentence(
        source.slice(previous.start, previous.end),
        source.slice(piece.start, piece.end),
      )
    ) {
      previous.end = piece.end;
    } else {
      pieces.push(piece);
    }
  }
  return pieces;
}

/**
 * Abbreviations common in legal writing, without their final period. A
 * sentence boundary right after one is almost always a false break. "id" is
 * deliberately absent: "See id." usually does end a sentence, and "Id. at 5"
 * is rejoined by the lowercase rule instead.
 */
const ABBREVIATIONS = new Set(
  [
    // Case names, parties, entities
    'v',
    'vs',
    'Inc',
    'Co',
    'Corp',
    'Ltd',
    'Bros',
    'Ass’n',
    "Ass'n",
    'Dep’t',
    "Dep't",
    'Gov’t',
    "Gov't",
    'Mr',
    'Mrs',
    'Ms',
    'Dr',
    'Jr',
    'Sr',
    'St',
    'Hon',
    'Pl',
    'Def',
    'al',
    // Record citations
    'Decl',
    'Aff',
    'Dep',
    'Depo',
    'Ex',
    'Exh',
    'Tr',
    'Br',
    'Mem',
    'Opp',
    'Supp',
    'App',
    'Doc',
    'Dkt',
    'R',
    // Statutes and reporters
    'No',
    'Nos',
    'Art',
    'Sec',
    'Ch',
    'Cl',
    'Cir',
    'Ct',
    'Cal',
    'Stat',
    'Ann',
    'Rev',
    'Reg',
    'Fed',
    'Civ',
    'Crim',
    'Proc',
    'Evid',
    'Lab',
    'Bus',
    'Prof',
    'Gen',
    'Pub',
    'Pen',
    'Fam',
    'Veh',
    'Ins',

    'Code',
    'para',
    'paras',
    'cl',
    'cf',
    'Cf',
    'pp',
    'p',
    'n',
    'nn',
    'ed',
    'eds',
    // Dates
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Sept',
    'Oct',
    'Nov',
    'Dec',
  ].map((abbreviation) => abbreviation.toLowerCase()),
);

/** Whether `next` is really a continuation of `previous` that the segmenter split off. */
function continuesSentence(previous: string, next: string): boolean {
  // "1999).", "5.", "at 15", "§ 22", "¶ 3": a sentence does not begin like this.
  if (/^[a-z0-9§¶]/.test(next)) return true;

  const lastToken =
    previous
      .split(/\s+/)
      .pop()
      ?.replace(/^[("'“‘[]+/, '') ?? '';
  if (!lastToken.endsWith('.')) return false;
  // "U.S.", "e.g.", and single initials ("John Q.", "R."): runs of letter-period pairs.
  if (/^(?:[A-Za-z]\.)+$/.test(lastToken)) return true;
  return ABBREVIATIONS.has(lastToken.slice(0, -1).toLowerCase());
}
