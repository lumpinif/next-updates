import fs from "node:fs/promises";
import path from "node:path";

import { promptReviewDeps } from "../prompts/review-deps";
import {
  collectReviewDepsReport,
  formatReviewDepsPromptMarkdown,
  writeReviewDepsReportJson,
} from "../tasks/review-deps";
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

export async function runReviewDepsFlow(options: {
  cwd: string;
  ui: ClackUi;
  depOverride?: "all" | "dependencies" | "devDependencies";
  debugDump?: boolean;
}): Promise<void> {
  const workspacesAvailable = await hasWorkspaces(options.cwd);
  const answers = await promptReviewDeps(options.ui, {
    dep: options.depOverride,
    scope: workspacesAvailable ? undefined : "root",
  });

  if (answers === null) {
    options.ui.outro("Cancelled.");
    return;
  }

  const debugDumpDir = options.debugDump
    ? path.resolve(options.cwd, "review-deps-debug")
    : undefined;

  const report = await options.ui.runSpinner("Running npm-check-updates…", () =>
    collectReviewDepsReport({
      cwd: options.cwd,
      scope: answers.scope,
      target: answers.target,
      dep: answers.dep,
      debugDumpDir,
    })
  );

  if (answers.output === "json") {
    const outPath = await writeReviewDepsReportJson({
      cwd: options.cwd,
      fileName: "review-deps-report.json",
      report,
    });
    options.ui.outro(`Wrote ${outPath}`);
    return;
  }

  options.ui.print(formatReviewDepsPromptMarkdown(report));
}
