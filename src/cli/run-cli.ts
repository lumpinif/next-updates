export type RunCliOptions = {
  argv: readonly string[];
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
};

import fs from "node:fs/promises";

import type { NextUpdatesPromptResult } from "./config/options";
import {
  depValues,
  outputValues,
  riskValues,
  scopeValues,
  targetValues,
} from "./config/options";
import {
  runNextUpdatesFlow,
  runNextUpdatesNonInteractive,
} from "./flows/next-updates-flow";
import {
  collectNextUpdatesGuideContext,
  formatNextUpdatesGuidePromptMarkdown,
} from "./prompts/next-updates-guide";
import { createClackUi } from "./ui/clack-ui";

type CliCommand = "help" | "version" | "run";

type RunOptions = NextUpdatesPromptResult;

type ParsedRunOptions = {
  hasRunFlags: boolean;
  debugDump: boolean;
  overrides: Partial<RunOptions>;
  resolved: RunOptions;
  errors: string[];
};

type FlagValue = {
  present: boolean;
  value?: string;
};

const DEFAULT_RUN_OPTIONS: RunOptions = {
  scope: "all",
  target: "latest",
  dep: "all",
  risk: "all",
  output: "prompt",
};

const HELP_TEXT = `next-updates

Usage:
  next-updates
  next-updates --interactive
  next-updates --scope <all|root|workspaces> --target <latest|minor|patch> --dep <all|dependencies|devDependencies> --risk <all|major-only|non-major|prerelease-only|unknown-only> --output <prompt|json>
  next-updates --help
  next-updates --version

Notes:
  - Running with no flags prints the agent guide prompt.
  - --output json writes next-updates-report.json to the current directory.

Options:
  --interactive, -i   Run the interactive UI wizard
  --scope             all|root|workspaces
  --target            latest|minor|patch
  --dep               all|dependencies|devDependencies
  --risk              all|major-only|non-major|prerelease-only|unknown-only
  --output, --format  prompt|json
  --debug-dump        Write debug dumps to ./next-updates-debug
`;

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  stream.write(`${line}\n`);
}

async function readPackageVersion(): Promise<string | null> {
  const candidates = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        continue;
      }
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string") {
        return version;
      }
    } catch {
      // Ignore missing package.json candidates.
    }
  }

  return null;
}

function parseCommand(args: readonly string[]): CliCommand {
  if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
    return "help";
  }

  if (
    args.includes("--version") ||
    args.includes("-v") ||
    args.includes("version")
  ) {
    return "version";
  }

  return "run";
}

function readFlagValue(args: readonly string[], flag: string): FlagValue {
  const flagIndex = args.findIndex(
    (cliArg) => cliArg === flag || cliArg.startsWith(`${flag}=`)
  );
  if (flagIndex === -1) {
    return { present: false };
  }

  const flagArg = args[flagIndex];
  if (flagArg === flag) {
    return { present: true, value: args[flagIndex + 1] };
  }

  return { present: true, value: flagArg.slice(flag.length + 1) };
}

function isAllowedValue<T extends string>(
  value: string,
  allowed: readonly T[]
): value is T {
  return allowed.includes(value as T);
}

function parseEnumFlag<T extends string>(
  args: readonly string[],
  flags: readonly string[],
  allowed: readonly T[],
  label: string
): { present: boolean; value?: T; error?: string } {
  const matches = flags
    .map((flag) => ({ flag, ...readFlagValue(args, flag) }))
    .filter((match) => match.present);

  if (matches.length === 0) {
    return { present: false };
  }

  for (const match of matches) {
    const value = match.value;
    if (!value || value.startsWith("-")) {
      return { present: true, error: `Missing value for ${label}.` };
    }
  }

  const uniqueValues = new Set(matches.map((match) => match.value));
  if (uniqueValues.size > 1) {
    return { present: true, error: `Conflicting values for ${label}.` };
  }

  const value = matches[0]?.value;
  if (!(value && isAllowedValue(value, allowed))) {
    const printable = value ?? "<missing>";
    return {
      present: true,
      error: `Invalid value for ${label}: ${printable}.`,
    };
  }

  return { present: true, value };
}

function parseRunOptions(args: readonly string[]): ParsedRunOptions {
  const errors: string[] = [];
  const scope = parseEnumFlag(args, ["--scope"], scopeValues, "--scope");
  const target = parseEnumFlag(args, ["--target"], targetValues, "--target");
  const dep = parseEnumFlag(args, ["--dep"], depValues, "--dep");
  const risk = parseEnumFlag(args, ["--risk"], riskValues, "--risk");
  const output = parseEnumFlag(
    args,
    ["--output", "--format"],
    outputValues,
    "--output/--format"
  );

  for (const entry of [scope, target, dep, risk, output]) {
    if (entry.error) {
      errors.push(entry.error);
    }
  }

  const overrides: Partial<RunOptions> = {};
  if (scope.value) {
    overrides.scope = scope.value;
  }
  if (target.value) {
    overrides.target = target.value;
  }
  if (dep.value) {
    overrides.dep = dep.value;
  }
  if (risk.value) {
    overrides.risk = risk.value;
  }
  if (output.value) {
    overrides.output = output.value;
  }

  const debugDump = args.includes("--debug-dump");
  const hasRunFlags =
    scope.present ||
    target.present ||
    dep.present ||
    risk.present ||
    output.present ||
    debugDump;

  const resolved: RunOptions = {
    scope: overrides.scope ?? DEFAULT_RUN_OPTIONS.scope,
    target: overrides.target ?? DEFAULT_RUN_OPTIONS.target,
    dep: overrides.dep ?? DEFAULT_RUN_OPTIONS.dep,
    risk: overrides.risk ?? DEFAULT_RUN_OPTIONS.risk,
    output: overrides.output ?? DEFAULT_RUN_OPTIONS.output,
  };

  return {
    hasRunFlags,
    debugDump,
    overrides,
    resolved,
    errors,
  };
}

function parseInteractive(args: readonly string[]): boolean {
  return args.includes("--interactive") || args.includes("-i");
}

export async function runCli(options: RunCliOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const args = options.argv.slice(2);
  const command = parseCommand(args);

  if (command === "version") {
    const version = await readPackageVersion();
    writeLine(
      stdout,
      version ? `next-updates v${version}` : "next-updates (unknown version)"
    );
    return;
  }

  if (command === "help") {
    writeLine(stdout, HELP_TEXT);
    return;
  }

  const parsed = parseRunOptions(args);
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      writeLine(stderr, error);
    }
    writeLine(stderr, "Run with --help to see valid options.");
    return;
  }

  const interactive = parseInteractive(args);
  if (!(interactive || parsed.hasRunFlags)) {
    const context = await collectNextUpdatesGuideContext(process.cwd());
    stdout.write(formatNextUpdatesGuidePromptMarkdown(context));
    return;
  }

  try {
    if (interactive) {
      const ui = createClackUi({ stdout });
      ui.intro("next-updates");
      await runNextUpdatesFlow({
        cwd: process.cwd(),
        ui,
        defaults: parsed.overrides,
        debugDump: parsed.debugDump,
      });
      return;
    }

    await runNextUpdatesNonInteractive({
      cwd: process.cwd(),
      stdout,
      scope: parsed.resolved.scope,
      target: parsed.resolved.target,
      dep: parsed.resolved.dep,
      risk: parsed.resolved.risk,
      output: parsed.resolved.output,
      debugDump: parsed.debugDump,
    });
    return;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    stderr.write(`${message}\n`);
    return;
  }
}
