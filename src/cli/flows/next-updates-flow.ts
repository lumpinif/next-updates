import fs from "node:fs/promises";
import path from "node:path";

import { promptNextUpdates } from "../prompts/next-updates";
import {
  collectNextUpdatesReport,
  formatNextUpdatesPromptMarkdown,
  writeNextUpdatesReportJson,
} from "../tasks/next-updates";
import type { ClackUi } from "../ui/clack-ui";

type PackageJson = {
  workspaces?: unknown;
};

async function hasWorkspaces(cwd: string): Promise<boolean> {
  const packageJsonPath = path.resolve(cwd, "package.json");
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }
  return (parsed as PackageJson).workspaces !== undefined;
}

export async function runNextUpdatesFlow(options: {
  cwd: string;
  ui: ClackUi;
  depOverride?: "all" | "dependencies" | "devDependencies";
  debugDump?: boolean;
}): Promise<void> {
  const workspacesAvailable = await hasWorkspaces(options.cwd);
  const answers = await promptNextUpdates(options.ui, {
    dep: options.depOverride,
    scope: workspacesAvailable ? undefined : "root",
  });

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
