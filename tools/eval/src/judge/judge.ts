import { z } from 'zod';
import { invokeStructured, promptMessages, type ModelProvider } from '@make-your-case/pipeline';
import { softLeaves, type AnswerKey } from '@make-your-case/answer-keys';
import { judgePrompt } from './judge.v1.ts';

/**
 * Soft grading (AGENTS.md section 8.7): a judge model reads each soft
 * expectation and says how well the produced model meets it.
 *
 * One call per leaf rather than one call for all of them. A single call invites
 * the model to average its verdicts, and a per-leaf grade is what the report
 * needs anyway.
 */

export const judgeVerdictSchema = z.object({
  grade: z.enum(['pass', 'partial', 'fail']),
  rationale: z.string(),
});

export interface SoftGrade {
  /** The dotted path of the leaf, e.g. `embedded_behaviors.alternative_routes`. */
  readonly path: string;
  readonly grade: 'pass' | 'partial' | 'fail' | 'error';
  readonly rationale: string;
}

export interface JudgeInput {
  readonly key: AnswerKey;
  readonly document: string;
  /** `renderGraph` output, or a note saying nothing was produced. */
  readonly produced: string;
}

export async function gradeSoftExpectations(
  input: JudgeInput,
  models: ModelProvider,
): Promise<SoftGrade[]> {
  const model = models.getChatModel('judge');
  const grades: SoftGrade[] = [];

  for (const leaf of softLeaves(input.key.soft)) {
    try {
      const verdict = await invokeStructured(
        model,
        judgeVerdictSchema,
        promptMessages(judgePrompt, {
          document: input.document,
          produced: input.produced,
          expectation: leaf.expectation,
        }),
        `judge:${leaf.path}`,
      );
      grades.push({ path: leaf.path, grade: verdict.grade, rationale: verdict.rationale });
    } catch (error) {
      // One unguessable leaf must not lose the other grades on a billed run.
      grades.push({
        path: leaf.path,
        grade: 'error',
        rationale: `the judge could not be reached: ${(error as Error).message}`,
      });
    }
  }

  return grades;
}
