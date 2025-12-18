export type RunCliOptions = {
  argv: readonly string[];
};

/**
 * CLI entrypoint (placeholder).
 *
 * This will later orchestrate:
 * - session lifecycle (intro/outro + cancellation handling)
 * - prompt flows (grouped questions)
 * - tasks with spinners/progress
 */
export async function runCli(_options: RunCliOptions): Promise<void> {
  await Promise.resolve();
  throw new Error("CLI not implemented yet.");
}
