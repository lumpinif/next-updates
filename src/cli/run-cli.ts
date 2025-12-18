export type RunCliOptions = {
  argv: readonly string[];
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
};

import { runReviewDepsFlow } from "./flows/review-deps-flow";
import type { ReviewDepsDep } from "./prompts/review-deps";
import { createClackUi } from "./ui/clack-ui";

type CliCommand = "help" | "version" | "run";

const HELP_TEXT = `review-deps

Usage:
  review-deps
  review-deps --help
  review-deps --version
`;

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  stream.write(`${line}\n`);
}

function parseCommand(args: readonly string[]): CliCommand {
  const [first] = args;

  if (first === "--help" || first === "-h" || first === "help") {
    return "help";
  }

  if (first === "--version" || first === "-v" || first === "version") {
    return "version";
  }

  if (first === undefined) {
    return "run";
  }

  return "run";
}

function parseDepOverride(args: readonly string[]): ReviewDepsDep | undefined {
  const depIndex = args.findIndex(
    (cliArg) => cliArg === "--dep" || cliArg.startsWith("--dep=")
  );
  if (depIndex === -1) {
    return;
  }

  const depArg = args[depIndex];
  let value: string | undefined;
  if (depArg === "--dep") {
    value = args[depIndex + 1];
  } else if (depArg.startsWith("--dep=")) {
    value = depArg.slice("--dep=".length);
  }

  if (
    value === "all" ||
    value === "dependencies" ||
    value === "devDependencies"
  ) {
    return value;
  }

  return;
}

export async function runCli(options: RunCliOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const args = options.argv.slice(2);
  const command = parseCommand(args);
  const depOverride = parseDepOverride(args);

  if (command === "version") {
    // Package version is wired through package managers; keeping placeholder until we formalize a version source.
    writeLine(stdout, "review-deps (version not wired yet)");
    return;
  }

  if (command === "help") {
    writeLine(stdout, HELP_TEXT);
    return;
  }

  try {
    const ui = createClackUi({ stdout });
    ui.intro("review-deps");
    await runReviewDepsFlow({
      cwd: process.cwd(),
      ui,
      depOverride,
    });
    return;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    stderr.write(`${message}\n`);
    return;
  }
}
