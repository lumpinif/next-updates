import path from "node:path";

import type {
  NextUpdatesDep,
  NextUpdatesOutput,
  NextUpdatesPromptResult,
  NextUpdatesRisk,
  NextUpdatesScope,
  NextUpdatesTarget,
} from "../config/options";
import { hasWorkspaceConfig } from "../fs/workspaces";
import { promptNextUpdates } from "../prompts/next-updates";
import {
  collectNextUpdatesReport,
  formatNextUpdatesPromptMarkdown,
  writeNextUpdatesReportJson,
} from "../tasks/next-updates";
import type { ClackUi } from "../ui/clack-ui";

export async function runNextUpdatesFlow(options: {
  cwd: string;
  ui: ClackUi;
  defaults?: Partial<NextUpdatesPromptResult>;
  debugDump?: boolean;
}): Promise<void> {
  const workspacesAvailable = await hasWorkspaceConfig(options.cwd);
  const defaults: Partial<NextUpdatesPromptResult> = {
    ...options.defaults,
  };
  if (!workspacesAvailable && defaults.scope === undefined) {
    defaults.scope = "root";
  }
  const answers = await promptNextUpdates(options.ui, defaults);

  if (answers === null) {
    options.ui.outro("Cancelled.");
    return;
  }

  const debugDumpDir = options.debugDump
    ? path.resolve(options.cwd, "next-updates-debug")
    : undefined;

  const report = await options.ui.runSpinner("Running npm-check-updates…", () =>
    collectNextUpdatesReport({
      cwd: options.cwd,
      scope: answers.scope,
      target: answers.target,
      dep: answers.dep,
      risk: answers.risk,
      debugDumpDir,
    })
  );

  if (answers.output === "json") {
    const outPath = await writeNextUpdatesReportJson({
      cwd: options.cwd,
      fileName: "next-updates-report.json",
      report,
    });
    options.ui.outro(`Wrote ${outPath}`);
    return;
  }

  options.ui.print(formatNextUpdatesPromptMarkdown(report));
}

export async function runNextUpdatesNonInteractive(options: {
  cwd: string;
  stdout: NodeJS.WriteStream;
  scope: NextUpdatesScope;
  target: NextUpdatesTarget;
  dep: NextUpdatesDep;
  risk: NextUpdatesRisk;
  output: NextUpdatesOutput;
  debugDump?: boolean;
}): Promise<void> {
  const debugDumpDir = options.debugDump
    ? path.resolve(options.cwd, "next-updates-debug")
    : undefined;

  const report = await collectNextUpdatesReport({
    cwd: options.cwd,
    scope: options.scope,
    target: options.target,
    dep: options.dep,
    risk: options.risk,
    debugDumpDir,
  });

  if (options.output === "json") {
    const outPath = await writeNextUpdatesReportJson({
      cwd: options.cwd,
      fileName: "next-updates-report.json",
      report,
    });
    options.stdout.write(`${outPath}\n`);
    return;
  }

  options.stdout.write(formatNextUpdatesPromptMarkdown(report));
}
