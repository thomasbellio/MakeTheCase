import type { ArgumentGraphDraft, LocalId } from '@make-your-case/domain';
import { fixture01Graph, fixture01Spans } from './01-valid-linked-deductive.ts';
import { fixture02Graph, fixture02Spans } from './02-valid-convergent.ts';
import { fixture04Graph, fixture04Spans } from './04-counterargument-rebuttal.ts';
import { fixture05Graph, fixture05Spans } from './05-contract-notice.ts';
import { fixture06Graph, fixture06Spans } from './06-circular.ts';
import { fixture07Graph, fixture07Spans } from './07-affirming-consequent.ts';
import { fixture08Graph, fixture08Spans } from './08-bald-assertion.ts';
import { fixture14Graph, fixture14Spans } from './14-long-brief-reduced.ts';

export interface Fixture {
  /** The stem of the answer key in `fixtures/arguments/`, or null if there is none. */
  readonly key: string | null;
  readonly graph: ArgumentGraphDraft;
  readonly spans: readonly LocalId[];
}

/** Fixtures that mirror a real answer key, in answer-key order. */
export const KEYED_FIXTURES: readonly Fixture[] = [
  { key: '01-valid-linked-deductive', graph: fixture01Graph, spans: fixture01Spans },
  { key: '02-valid-convergent', graph: fixture02Graph, spans: fixture02Spans },
  { key: '04-counterargument-rebuttal', graph: fixture04Graph, spans: fixture04Spans },
  { key: '05-contract-notice', graph: fixture05Graph, spans: fixture05Spans },
  { key: '06-circular', graph: fixture06Graph, spans: fixture06Spans },
  { key: '07-affirming-consequent', graph: fixture07Graph, spans: fixture07Spans },
  { key: '08-bald-assertion', graph: fixture08Graph, spans: fixture08Spans },
  { key: '14-long-brief', graph: fixture14Graph, spans: fixture14Spans },
];

export * from './01-valid-linked-deductive.ts';
export * from './02-valid-convergent.ts';
export * from './04-counterargument-rebuttal.ts';
export * from './05-contract-notice.ts';
export * from './06-circular.ts';
export * from './07-affirming-consequent.ts';
export * from './08-bald-assertion.ts';
export * from './14-long-brief-reduced.ts';
export * from './invalid-graph.ts';
export * from './unconnected-background.ts';
