import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { answerKeySchema, type AnswerKey } from './schema.ts';

/**
 * Reads the fixture pairs in `fixtures/arguments/` (AGENTS.md section 8.7).
 *
 * The markdown is exactly what a user would paste and is never sent alongside
 * its answer key: a fixture's `.md` goes to the pipeline, its key only to the
 * scorer and the judge.
 */

export const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/arguments/', import.meta.url));

export interface FixtureCase {
  /** `05-contract-notice` — the shared stem of both files. */
  readonly stem: string;
  readonly markdownPath: string;
  readonly sourceText: string;
  readonly key: AnswerKey;
}

const KEY_SUFFIX = '.expected.yaml';

export function parseAnswerKey(stem: string, yamlText: string): AnswerKey {
  const parsed: unknown = parse(yamlText);
  const result = answerKeySchema.safeParse(parsed);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`${stem}${KEY_SUFFIX} does not match the answer-key schema:\n${problems}`);
  }

  if (result.data.id !== stem) {
    throw new Error(
      `${stem}${KEY_SUFFIX} declares id "${result.data.id}"; it must match the file stem.`,
    );
  }

  return result.data;
}

export async function loadAnswerKey(
  stem: string,
  dir: string = FIXTURES_DIR,
): Promise<FixtureCase> {
  const markdownPath = path.join(dir, `${stem}.md`);
  const [sourceText, yamlText] = await Promise.all([
    readFile(markdownPath, 'utf8'),
    readFile(path.join(dir, `${stem}${KEY_SUFFIX}`), 'utf8'),
  ]);

  return { stem, markdownPath, sourceText, key: parseAnswerKey(stem, yamlText) };
}

/**
 * Every fixture, in stem order.
 *
 * An unpaired file is an error rather than a silent skip: section 4 says only
 * fixture pairs belong in that directory, so a `.md` with no key is a mistake
 * worth hearing about, not a fixture to quietly drop.
 */
export async function loadAnswerKeys(dir: string = FIXTURES_DIR): Promise<FixtureCase[]> {
  const entries = await readdir(dir);

  const stems = entries
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -'.md'.length))
    .sort();

  const keyStems = new Set(
    entries.filter((n) => n.endsWith(KEY_SUFFIX)).map((n) => n.slice(0, -KEY_SUFFIX.length)),
  );

  const unpaired = [
    ...stems.filter((stem) => !keyStems.has(stem)).map((stem) => `${stem}.md has no answer key`),
    ...[...keyStems]
      .filter((stem) => !stems.includes(stem))
      .sort()
      .map((stem) => `${stem}${KEY_SUFFIX} has no markdown`),
  ];
  if (unpaired.length > 0) {
    throw new Error(
      `${dir} contains unpaired fixtures:\n${unpaired.map((u) => `  ${u}`).join('\n')}`,
    );
  }

  return Promise.all(stems.map((stem) => loadAnswerKey(stem, dir)));
}

/** Resolves a `--fixture` argument like `05` or `05-contract-notice` to a stem. */
export async function resolveFixtureStem(
  selector: string,
  dir: string = FIXTURES_DIR,
): Promise<string> {
  const entries = await readdir(dir);
  const stems = entries.filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -'.md'.length));

  const matches = stems
    .filter((stem) => stem === selector || stem.startsWith(`${selector}-`))
    .sort();
  const [only] = matches;
  if (only !== undefined && matches.length === 1) return only;
  if (matches.length === 0) throw new Error(`no fixture matches "${selector}"`);
  throw new Error(`"${selector}" matches several fixtures: ${matches.join(', ')}`);
}
