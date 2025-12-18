import { promptReviewDeps } from "../prompts/review-deps";
import {
  collectReviewDepsReport,
  formatReviewDepsPromptMarkdown,
  writeReviewDepsReportJson,
} from "../tasks/review-deps";
import type { ClackUi } from "../ui/clack-ui";

export async function runReviewDepsFlow(options: {
  cwd: string;
  ui: ClackUi;
  depOverride?: "all" | "dependencies" | "devDependencies";
}): Promise<void> {
  const answers = await promptReviewDeps(options.ui, {
    dep: options.depOverride,
  });
  if (answers === null) {
    options.ui.outro("Cancelled.");
    return;
  }

  const report = await options.ui.runSpinner("Running npm-check-updates…", () =>
    collectReviewDepsReport({
      cwd: options.cwd,
      scope: answers.scope,
      target: answers.target,
      dep: answers.dep,
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
