import { describe, expect, it } from 'vitest';
import {
  attributionSchema,
  claimKindSchema,
  documentRoleSchema,
  findingKindSchema,
  inferenceSchemeSchema,
  modalitySchema,
  originSchema,
  pipelineStageSchema,
  relationTypeSchema,
  runEventTypeSchema,
  runStatusSchema,
  severitySchema,
  spanFunctionSchema,
} from '@make-your-case/domain';
import * as pg from '../src/schema/enums.ts';

/**
 * The domain Zod enums and the Postgres enum types are two spellings of the
 * same list. Nothing in the type system ties them together, and a mismatch
 * would surface only as a runtime insert failure, so it is checked here.
 *
 * Adding a value means editing both and generating a migration.
 */
const PAIRS = [
  ['document_role', documentRoleSchema, pg.documentRole],
  ['span_function', spanFunctionSchema, pg.spanFunction],
  ['run_status', runStatusSchema, pg.runStatus],
  ['pipeline_stage', pipelineStageSchema, pg.pipelineStage],
  ['run_event_type', runEventTypeSchema, pg.runEventType],
  ['claim_kind', claimKindSchema, pg.claimKind],
  ['modality', modalitySchema, pg.modality],
  ['origin', originSchema, pg.origin],
  ['attribution', attributionSchema, pg.attribution],
  ['inference_scheme', inferenceSchemeSchema, pg.inferenceScheme],
  ['relation_type', relationTypeSchema, pg.relationType],
  ['finding_kind', findingKindSchema, pg.findingKind],
  ['severity', severitySchema, pg.severity],
] as const;

describe('domain enums and Postgres enums agree', () => {
  it.each(PAIRS.map(([name, zod, enumType]) => [name, zod, enumType] as const))(
    '%s',
    (_name, zod, enumType) => {
      // Order matters in Postgres (it defines sort order), so compare as lists.
      expect([...enumType.enumValues]).toEqual([...zod.options]);
    },
  );

  it('covers every Postgres enum defined in the schema', () => {
    // `pgEnum` returns a callable, so this cannot filter on `typeof object`.
    const declared = Object.entries(pg)
      .filter(([, value]) => value !== null && typeof value === 'function' && 'enumValues' in value)
      .map(([key]) => key);
    expect(declared).toHaveLength(PAIRS.length);
  });
});
