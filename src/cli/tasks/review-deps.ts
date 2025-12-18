import fs from "node:fs/promises";
import path from "node:path";

import { type RunOptions, run } from "npm-check-updates";

import type {
  ReviewDepsDep,
  ReviewDepsScope,
  ReviewDepsTarget,
} from "../prompts/review-deps";

export type ReviewDepsCandidate = {
  packageFile: string;
  dependencyType: "dependencies" | "devDependencies" | "unknown";
  packageName: string;
  currentSpec: string;
  upgradedSpec: string;
};

export type ReviewDepsReport = {
  generatedAt: string;
  options: {
    scopeRequested: ReviewDepsScope;
    scopeEffective: ReviewDepsScope;
    target: ReviewDepsTarget;
    dep: ReviewDepsDep;
  };
  candidates: ReviewDepsCandidate[];
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
};

function hasWorkspacesField(packageJson: PackageJson): boolean {
  return packageJson.workspaces !== undefined;
}

function createRunOptions(
  cwd: string,
  scope: ReviewDepsScope,
  target: ReviewDepsTarget,
  dep: ReviewDepsDep
): RunOptions {
  let depValue: readonly string[];
  if (dep === "all") {
    depValue = ["prod", "dev"];
  } else if (dep === "dependencies") {
    depValue = ["prod"];
  } else {
    depValue = ["dev"];
  }

  const runOptions: RunOptions = {
    cwd,
    silent: true,
    jsonUpgraded: true,
    target,
    dep: depValue,
  };

  if (scope === "all") {
    runOptions.workspaces = true;
    runOptions.root = true;
  }

  if (scope === "workspaces") {
    runOptions.workspaces = true;
    runOptions.root = false;
  }

  return runOptions;
}

async function readPackageJson(packageFile: string): Promise<PackageJson> {
  const raw = await fs.readFile(packageFile, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid package.json at ${packageFile}`);
  }
  return parsed as PackageJson;
}

function getDependencyTypeAndCurrentSpec(
  packageJson: PackageJson,
  packageName: string
): {
  dependencyType: ReviewDepsCandidate["dependencyType"];
  currentSpec: string;
} {
  const fromDeps = packageJson.dependencies?.[packageName];
  if (typeof fromDeps === "string") {
    return { dependencyType: "dependencies", currentSpec: fromDeps };
  }

  const fromDevDeps = packageJson.devDependencies?.[packageName];
  if (typeof fromDevDeps === "string") {
    return { dependencyType: "devDependencies", currentSpec: fromDevDeps };
  }

  return { dependencyType: "unknown", currentSpec: "" };
}

type NcuUpgradedFlat = Record<string, string>;
type NcuUpgradedWorkspaces = Record<string, NcuUpgradedFlat>;

function isWorkspacesResult(result: unknown): result is NcuUpgradedWorkspaces {
  if (typeof result !== "object" || result === null) {
    return false;
  }

  for (const value of Object.values(result as Record<string, unknown>)) {
    if (typeof value === "object" && value !== null) {
      return true;
    }
  }

  return false;
}

export async function collectReviewDepsReport(options: {
  cwd: string;
  scope: ReviewDepsScope;
  target: ReviewDepsTarget;
  dep: ReviewDepsDep;
}): Promise<ReviewDepsReport> {
  const generatedAt = new Date().toISOString();

  const rootPackageFile = path.resolve(options.cwd, "package.json");
  const rootPackageJson = await readPackageJson(rootPackageFile);
  const workspacesAvailable = hasWorkspacesField(rootPackageJson);

  let scopeEffective: ReviewDepsScope = options.scope;
  if (!workspacesAvailable && options.scope === "all") {
    scopeEffective = "root";
  }

  if (!workspacesAvailable && options.scope === "workspaces") {
    return {
      generatedAt,
      options: {
        scopeRequested: options.scope,
        scopeEffective,
        target: options.target,
        dep: options.dep,
      },
      candidates: [],
    };
  }

  const runOptions = createRunOptions(
    options.cwd,
    scopeEffective,
    options.target,
    options.dep
  );

  const upgraded = await run(runOptions);
  const candidates: ReviewDepsCandidate[] = [];

  if (upgraded === undefined) {
    return {
      generatedAt,
      options: {
        scopeRequested: options.scope,
        scopeEffective,
        target: options.target,
        dep: options.dep,
      },
      candidates,
    };
  }

  if (isWorkspacesResult(upgraded)) {
    for (const [packageFileRelative, upgradedMap] of Object.entries(upgraded)) {
      const packageFile = path.resolve(options.cwd, packageFileRelative);
      const packageJson = await readPackageJson(packageFile);

      for (const [packageName, upgradedSpec] of Object.entries(upgradedMap)) {
        const { dependencyType, currentSpec } = getDependencyTypeAndCurrentSpec(
          packageJson,
          packageName
        );

        candidates.push({
          packageFile: packageFileRelative,
          dependencyType,
          packageName,
          currentSpec,
          upgradedSpec,
        });
      }
    }
  } else {
    const upgradedMap = upgraded as NcuUpgradedFlat;
    const packageFile = path.resolve(options.cwd, "package.json");
    const packageJson = await readPackageJson(packageFile);

    for (const [packageName, upgradedSpec] of Object.entries(upgradedMap)) {
      const { dependencyType, currentSpec } = getDependencyTypeAndCurrentSpec(
        packageJson,
        packageName
      );

      candidates.push({
        packageFile: "package.json",
        dependencyType,
        packageName,
        currentSpec,
        upgradedSpec,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.packageFile !== b.packageFile) {
      return a.packageFile.localeCompare(b.packageFile);
    }
    return a.packageName.localeCompare(b.packageName);
  });

  return {
    generatedAt,
    options: {
      scopeRequested: options.scope,
      scopeEffective,
      target: options.target,
      dep: options.dep,
    },
    candidates,
  };
}

export function formatReviewDepsPromptMarkdown(
  report: ReviewDepsReport
): string {
  const lines: string[] = [
    "# review-deps (P0)",
    "",
    "Candidate dependency updates (from npm-check-updates).",
    "",
    `- Generated at: ${report.generatedAt}`,
    report.options.scopeRequested === report.options.scopeEffective
      ? `- Scope: ${report.options.scopeRequested}`
      : `- Scope: ${report.options.scopeRequested} (effective: ${report.options.scopeEffective})`,
    `- Target: ${report.options.target}`,
    `- Dep: ${report.options.dep}`,
    "",
  ];

  if (report.candidates.length === 0) {
    lines.push("No updates found.");
    return `${lines.join("\n")}\n`;
  }

  const grouped = groupCandidatesByPackageFile(report.candidates);
  for (const [packageFile, list] of grouped) {
    lines.push(`## ${packageFile}`, "");
    for (const item of list) {
      lines.push(formatCandidateLine(item));
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function groupCandidatesByPackageFile(
  candidates: readonly ReviewDepsCandidate[]
): Map<string, ReviewDepsCandidate[]> {
  const grouped = new Map<string, ReviewDepsCandidate[]>();
  for (const candidate of candidates) {
    const list = grouped.get(candidate.packageFile);
    if (list === undefined) {
      grouped.set(candidate.packageFile, [candidate]);
      continue;
    }
    list.push(candidate);
  }
  return grouped;
}

function formatCandidateLine(candidate: ReviewDepsCandidate): string {
  const current =
    candidate.currentSpec === "" ? "<unknown>" : candidate.currentSpec;

  let typeSuffix = "";
  if (candidate.dependencyType === "devDependencies") {
    typeSuffix = " (dev)";
  }

  return `- \`${candidate.packageName}\`${typeSuffix}: \`${current}\` → \`${candidate.upgradedSpec}\``;
}

export async function writeReviewDepsReportJson(options: {
  cwd: string;
  fileName: string;
  report: ReviewDepsReport;
}): Promise<string> {
  const outPath = path.resolve(options.cwd, options.fileName);
  await fs.writeFile(outPath, `${JSON.stringify(options.report, null, 2)}\n`);
  return outPath;
}
