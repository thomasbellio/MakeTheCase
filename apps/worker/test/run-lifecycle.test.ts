import { describe, expect, it } from 'vitest';
import { newId, type RevisionId } from '@make-your-case/domain';
import { UNEXPECTED_FAILURE_MESSAGE, modelConfig, terminalUpdate } from '../src/run-lifecycle.ts';
import { FakeModelProvider } from '@make-your-case/pipeline/testing';

describe('terminalUpdate', () => {
  it('records the revision a completed run produced', () => {
    const revisionId = newId<RevisionId>();
    expect(terminalUpdate({ status: 'completed', revisionId })).toMatchObject({
      status: 'completed',
      revision_id: revisionId,
      current_stage: null,
    });
  });

  it('records the summary a non-argument run produced', () => {
    // The database requires it when the status is `not_an_argument`.
    expect(terminalUpdate({ status: 'not_an_argument', summary: 'A recipe.' })).toMatchObject({
      status: 'not_an_argument',
      summary: 'A recipe.',
    });
  });

  it("records a failed run's user-safe message", () => {
    expect(terminalUpdate({ status: 'failed', message: 'Could not be mapped.' })).toMatchObject({
      status: 'failed',
      error: 'Could not be mapped.',
    });
  });

  it('clears the current stage and stamps a finish time whatever the outcome', () => {
    for (const outcome of [
      { status: 'completed' as const, revisionId: newId<RevisionId>() },
      { status: 'not_an_argument' as const, summary: 'A recipe.' },
      { status: 'failed' as const, message: 'Could not be mapped.' },
    ]) {
      const update = terminalUpdate(outcome);
      expect(update.current_stage).toBeNull();
      expect(update.finished_at).toBeInstanceOf(Date);
    }
  });
});

describe('modelConfig', () => {
  it('records the provider, model and prompt version per stage', () => {
    const config = modelConfig(new FakeModelProvider({}));

    expect(config).toHaveProperty('stages');
    expect(config).toHaveProperty('prompts');
    expect(Object.keys(config.prompts as object)).toContain('reconstruct');
  });

  it('carries no API key', () => {
    // `describe()` is secret-free by construction; this guards the composition.
    expect(JSON.stringify(modelConfig(new FakeModelProvider({})))).not.toMatch(/sk-|api[_-]?key/i);
  });
});

describe('UNEXPECTED_FAILURE_MESSAGE', () => {
  it('says what happened and what to do, without naming internals', () => {
    expect(UNEXPECTED_FAILURE_MESSAGE).toMatch(/stopped unexpectedly/);
    expect(UNEXPECTED_FAILURE_MESSAGE).toMatch(/submitted again/);
    expect(UNEXPECTED_FAILURE_MESSAGE).not.toMatch(/error|stack|schema|provider/i);
  });
});
