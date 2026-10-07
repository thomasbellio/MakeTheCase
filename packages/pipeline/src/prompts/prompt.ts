/**
 * A versioned prompt (AGENTS.md section 8.2). Changing a prompt's wording
 * means a new version, so `AnalysisRun.model_config` and eval reports can
 * attribute a change in results to the prompt that caused it.
 */
export interface Prompt<Input> {
  readonly id: string;
  readonly version: number;
  readonly system: string;
  render(input: Input): string;
}

/** `classify@1`, the form recorded in `model_config`. */
export function promptLabel(prompt: Prompt<never>): string {
  return `${prompt.id}@${String(prompt.version)}`;
}
