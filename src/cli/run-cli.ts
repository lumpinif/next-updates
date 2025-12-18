export type RunCliOptions = {
  argv: readonly string[];
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
};

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runCli(options: RunCliOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const args = options.argv.slice(2);
  const command = parseCommand(args);

  if (command === "version") {
    // Package version is wired through package managers; keeping placeholder until we formalize a version source.
    writeLine(stdout, "review-deps (version not wired yet)");
    return;
  }

  if (command === "help") {
    writeLine(stdout, HELP_TEXT);
    return;
  }

  const ui = createClackUi();
  ui.intro("review-deps");

  const action = await ui.selectAction();
  if (action === "exit") {
    ui.outro("Bye.");
    return;
  }

  await ui.runSpinner("Preparing…", async () => {
    await delay(250);
  });

  ui.outro("You're all set!");
}
