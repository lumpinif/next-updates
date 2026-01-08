import {
  dependencyTypeOrder,
  type NextUpdatesCandidateBase,
  type NextUpdatesPackageDetails,
  type NextUpdatesPackages,
  type NextUpdatesReport,
} from "../types";

export function formatNextUpdatesPromptMarkdown(
  report: NextUpdatesReport
): string {
  const lines: string[] = [
    "# next-updates (P0)",
    "",
    "Candidate dependency updates (from npm-check-updates).",
    "",
    `- Generated at: ${report.generatedAt}`,
    report.options.scopeRequested === report.options.scopeEffective
      ? `- Scope: ${report.options.scopeRequested}`
      : `- Scope: ${report.options.scopeRequested} (effective: ${report.options.scopeEffective})`,
    `- Target: ${report.options.target}`,
    `- Dep: ${report.options.dep}`,
    `- Risk: ${report.options.risk}`,
    "",
  ];

  if (!hasPackages(report.packages)) {
    lines.push("No updates found.");
    return `${lines.join("\n")}\n`;
  }

  const packageFiles = Object.keys(report.packages).sort();
  for (const packageFile of packageFiles) {
    const fileGroup = report.packages[packageFile];
    lines.push(`## ${packageFile}`, "");
    for (const dependencyType of dependencyTypeOrder) {
      const depGroup = fileGroup[dependencyType];
      if (!depGroup) {
        continue;
      }
      const packageNames = Object.keys(depGroup).sort();
      for (const packageName of packageNames) {
        const details = depGroup[packageName];
        lines.push(formatPackageLine(packageName, dependencyType, details));
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function hasPackages(packages: NextUpdatesPackages): boolean {
  for (const fileGroup of Object.values(packages)) {
    for (const dependencyType of dependencyTypeOrder) {
      const depGroup = fileGroup[dependencyType];
      if (depGroup && Object.keys(depGroup).length > 0) {
        return true;
      }
    }
  }
  return false;
}

function formatPackageLine(
  packageName: string,
  dependencyType: NextUpdatesCandidateBase["dependencyType"],
  details: NextUpdatesPackageDetails
): string {
  const currentRange =
    details.current.range === "" ? "<unknown>" : details.current.range;
  const installed = details.current.version ?? "<unknown>";
  const targetRange =
    details.target.range === "" ? "<unknown>" : details.target.range;
  const targetVersion = details.target.version ?? "<unknown>";

  let typeSuffix = "";
  if (dependencyType === "devDependencies") {
    typeSuffix = " (dev)";
  }

  return `- \`${packageName}\`${typeSuffix}: \`${currentRange}\` → \`${targetRange}\` (installed: \`${installed}\`, target: \`${targetVersion}\`)`;
}
