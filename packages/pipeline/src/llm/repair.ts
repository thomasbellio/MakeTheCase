/**
 * Recovering a structured response that does not match its schema.
 *
 * Models asked for a large nested object sometimes return one whose top-level
 * array fields arrive as JSON *text* rather than JSON. The shape of the damage
 * varies — the string may hold just that field's value, or that value followed
 * by the object's remaining fields, sometimes with the object's closing brace
 * attached, and sometimes the output is simply cut short mid-element.
 *
 * Guessing which shape it is from one example is how you end up with a repair
 * that works on the payload you saw and nothing else. So instead of deciding,
 * this proposes a handful of candidate readings and lets the caller's schema
 * choose: a candidate is only accepted if it validates.
 */

/** The most candidates worth proposing. A bound, so a pathological payload cannot blow up. */
const MAX_CANDIDATES = 32;

type Bracket = '[' | '{';

const CLOSING: Readonly<Record<Bracket, string>> = { '[': ']', '{': '}' };

interface Boundary {
  /** Index just past a completed element. */
  readonly index: number;
  /** The brackets still open at that point, outermost first. */
  readonly open: readonly Bracket[];
}

/**
 * Walks JSON text, noting every point at which an element finishes while a
 * container is still open.
 *
 * Those are the only places truncated text can be safely cut: anywhere else
 * leaves a half-written value.
 */
function scan(text: string): {
  readonly boundaries: readonly Boundary[];
  readonly balanced: boolean;
} {
  const open: Bracket[] = [];
  const boundaries: Boundary[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '[' || char === '{') {
      open.push(char);
    } else if (char === ']' || char === '}') {
      open.pop();
      if (open.length > 0) boundaries.push({ index: i + 1, open: [...open] });
    }
  }

  return { boundaries, balanced: open.length === 0 && !inString };
}

/** True when the text stops in the middle of a value, rather than simply being invalid. */
export function looksTruncated(text: string): boolean {
  return !scan(text).balanced;
}

/**
 * Parses JSON, tolerating the two ways a model tends to damage the end of it:
 * trailing punctuation that belongs to the enclosing object, and an output that
 * stops mid-element.
 *
 * Closing a truncated structure **discards the incomplete trailing element**.
 * That loses data, so it is the last thing tried — but a reconstruction missing
 * its last claim fails validation with a specific, fixable complaint, which the
 * retry loop can act on, whereas an unparseable response fails the run outright.
 */
export function parseJsonLoose(
  text: string,
): { readonly value: unknown; readonly truncated: boolean } | undefined {
  const direct = tryParse(text);
  if (direct !== undefined) return { value: direct.value, truncated: false };

  // Trailing `}`, `]` or `,` left over from the object this text was cut out of.
  let trimmed = text.trimEnd();
  for (let i = 0; i < 3 && trimmed.length > 0; i += 1) {
    const last = trimmed.at(-1);
    if (last !== '}' && last !== ']' && last !== ',') break;
    trimmed = trimmed.slice(0, -1).trimEnd();
    const parsed = tryParse(trimmed);
    if (parsed !== undefined) return { value: parsed.value, truncated: false };
  }

  const { boundaries } = scan(text);
  // Latest boundary first: keep as much of the response as possible.
  for (const boundary of [...boundaries].reverse()) {
    const closed =
      text.slice(0, boundary.index) +
      [...boundary.open]
        .reverse()
        .map((bracket) => CLOSING[bracket])
        .join('');
    const parsed = tryParse(closed);
    if (parsed !== undefined) return { value: parsed.value, truncated: true };
  }

  return undefined;
}

function tryParse(text: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string that might be JSON rather than prose. */
function looksLikeJson(value: unknown): value is string {
  return typeof value === 'string' && /^\s*[[{]/.test(value);
}

export interface RepairCandidate {
  readonly value: unknown;
  /** True when producing it discarded a truncated trailing element. */
  readonly truncated: boolean;
}

/**
 * Candidate readings of a malformed response, in the order worth trying.
 *
 * The schema decides which one is right, so being generous here is safe: a
 * wrong candidate simply fails to validate.
 */
export function repairCandidates(raw: unknown): readonly RepairCandidate[] {
  const candidates: RepairCandidate[] = [{ value: raw, truncated: false }];

  const push = (candidate: RepairCandidate): void => {
    if (candidates.length < MAX_CANDIDATES) candidates.push(candidate);
  };

  // The whole argument object arrived as text.
  if (typeof raw === 'string') {
    const parsed = parseJsonLoose(raw);
    if (parsed !== undefined) {
      push({ value: parsed.value, truncated: parsed.truncated });
      // That text may itself contain a damaged field.
      if (isRecord(parsed.value)) {
        for (const candidate of repairCandidates(parsed.value)) push(candidate);
      }
    }
    return candidates;
  }

  if (!isRecord(raw)) return candidates;

  for (const [key, field] of Object.entries(raw)) {
    if (!looksLikeJson(field)) continue;

    // The field holds only its own value: {"claims": "[...]"}.
    const alone = parseJsonLoose(field);
    if (alone !== undefined) {
      push({ value: { ...raw, [key]: alone.value }, truncated: alone.truncated });

      // The field holds a whole object that should have been the response:
      // {"claims": "{\"claims\":[...],\"inferences\":[...]}"}.
      if (isRecord(alone.value)) {
        push({ value: { ...raw, ...alone.value }, truncated: alone.truncated });
        push({ value: alone.value, truncated: alone.truncated });
      }
    }

    // The field holds its value *and* the object's remaining fields:
    // {"claims": "[...],\"inferences\":[...]"} — so parse it back inside the
    // object it was cut out of.
    const inContext = parseJsonLoose(`{${JSON.stringify(key)}:${field}}`);
    if (inContext !== undefined && isRecord(inContext.value)) {
      push({ value: { ...raw, ...inContext.value }, truncated: inContext.truncated });
    }
  }

  return candidates;
}
