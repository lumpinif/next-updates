import fs from "node:fs/promises";
import path from "node:path";

import { run as ncuRun, type RunOptions } from "npm-check-updates";

import type {
  NextUpdatesDep,
  NextUpdatesScope,
  NextUpdatesTarget,
} from "../prompts/next-updates";

export type NextUpdatesCandidate = {
  packageFile: string;
  dependencyType: "dependencies" | "devDependencies" | "unknown";
  packageName: string;
  currentSpec: string;
  upgradedSpec: string;
};

export type NextUpdatesReport = {
  generatedAt: string;
  options: {
    scopeRequested: NextUpdatesScope;
    scopeEffective: NextUpdatesScope;
    target: NextUpdatesTarget;
    dep: NextUpdatesDep;
  };
  candidates: NextUpdatesCandidate[];
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
  scope: NextUpdatesScope,
  target: NextUpdatesTarget,
  dep: NextUpdatesDep
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

function resolveScopeEffective(
  scopeRequested: NextUpdatesScope,
  workspacesAvailable: boolean
): NextUpdatesScope {
  if (workspacesAvailable || scopeRequested === "root") {
    return scopeRequested;
  }
  return "root";
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
  dependencyType: NextUpdatesCandidate["dependencyType"];
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

type NcuUpgraded = NcuUpgradedFlat | NcuUpgradedWorkspaces | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceNcuUpgraded(result: unknown): NcuUpgraded {
  if (result === undefined) {
    return;
  }

  const record = toRecordOrNull(result);
  if (record === null) {
    throw new Error("Invalid upgraded dependencies found");
  }

  const entries = Object.entries(record);
  if (entries.length === 0) {
    return {};
  }

  if (looksLikeWorkspaces(entries)) {
    return coerceWorkspaces(entries);
  }

  return coerceFlat(entries);
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function looksLikeWorkspaces(entries: [string, unknown][]): boolean {
  return entries.some(([key]) => key.endsWith("package.json"));
}

function coerceWorkspaces(entries: [string, unknown][]): NcuUpgradedWorkspaces {
  const workspaces: NcuUpgradedWorkspaces = {};
  for (const [packageFile, upgrades] of entries) {
    const upgradesRecord = toRecordOrNull(upgrades);
    if (upgradesRecord === null) {
      throw new Error("Invalid upgraded dependencies found");
    }
    workspaces[packageFile] = coerceFlat(Object.entries(upgradesRecord));
  }
  return workspaces;
}

function coerceFlat(entries: [string, unknown][]): NcuUpgradedFlat {
  const flat: NcuUpgradedFlat = {};
  for (const [packageName, upgradedSpec] of entries) {
    if (typeof upgradedSpec !== "string") {
      throw new Error("Invalid upgraded dependencies found");
    }
    flat[packageName] = upgradedSpec;
  }
  return flat;
}

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

type NormalizedNcuCandidate = {
  packageFile: string;
  packageName: string;
  upgradedSpec: string;
};

function normalizeNcuResult(upgraded: NcuUpgraded): NormalizedNcuCandidate[] {
  if (upgraded === undefined) {
    return [];
  }

  if (isWorkspacesResult(upgraded)) {
    const normalized: NormalizedNcuCandidate[] = [];
    for (const [packageFile, upgrades] of Object.entries(upgraded)) {
      for (const [packageName, upgradedSpec] of Object.entries(upgrades)) {
        normalized.push({
          packageFile,
          packageName,
          upgradedSpec,
        });
      }
    }
    return normalized;
  }

  return Object.entries(upgraded).map(([packageName, upgradedSpec]) => ({
    packageFile: "package.json",
    packageName,
    upgradedSpec,
  }));
}

async function writeDebugDump(
  dir: string,
  fileName: string,
  data: unknown
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, fileName);
  await fs.writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`);
}

async function buildCandidatesFromWorkspaces(
  cwd: string,
  upgraded: NcuUpgradedWorkspaces
): Promise<NextUpdatesCandidate[]> {
  const candidates: NextUpdatesCandidate[] = [];
  for (const [packageFileRelative, upgradedMap] of Object.entries(upgraded)) {
    const packageFile = path.resolve(cwd, packageFileRelative);
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
  return candidates;
}

async function buildCandidatesFromRoot(
  cwd: string,
  upgraded: NcuUpgradedFlat
): Promise<NextUpdatesCandidate[]> {
  const packageFile = path.resolve(cwd, "package.json");
  const packageJson = await readPackageJson(packageFile);
  return Object.entries(upgraded).map(([packageName, upgradedSpec]) => {
    const { dependencyType, currentSpec } = getDependencyTypeAndCurrentSpec(
      packageJson,
      packageName
    );

    return {
      packageFile: "package.json",
      dependencyType,
      packageName,
      currentSpec,
      upgradedSpec,
    };
  });
}

function buildCandidates(
  cwd: string,
  upgraded: NcuUpgraded
): Promise<NextUpdatesCandidate[]> {
  if (upgraded === undefined) {
    return Promise.resolve([]);
  }

  if (isWorkspacesResult(upgraded)) {
    return buildCandidatesFromWorkspaces(cwd, upgraded);
  }

  return buildCandidatesFromRoot(cwd, upgraded);
}

function sortCandidates(candidates: NextUpdatesCandidate[]): void {
  candidates.sort((a, b) => {
    if (a.packageFile !== b.packageFile) {
      return a.packageFile.localeCompare(b.packageFile);
    }
    return a.packageName.localeCompare(b.packageName);
  });
}

export async function collectNextUpdatesReport(options: {
  cwd: string;
  scope: NextUpdatesScope;
  target: NextUpdatesTarget;
  dep: NextUpdatesDep;
  debugDumpDir?: string;
}): Promise<NextUpdatesReport> {
  const generatedAt = new Date().toISOString();

  const rootPackageFile = path.resolve(options.cwd, "package.json");
  const rootPackageJson = await readPackageJson(rootPackageFile);
  const workspacesAvailable = hasWorkspacesField(rootPackageJson);

  const scopeEffective = resolveScopeEffective(
    options.scope,
    workspacesAvailable
  );

  const runOptions = createRunOptions(
    options.cwd,
    scopeEffective,
    options.target,
    options.dep
  );

  const upgradedRaw = await ncuRun(runOptions);
  const upgraded = coerceNcuUpgraded(upgradedRaw);
  if (options.debugDumpDir) {
    await writeDebugDump(
      options.debugDumpDir,
      "00-ncu-raw.json",
      upgradedRaw ?? null
    );
    const normalized = normalizeNcuResult(upgraded);
    await writeDebugDump(
      options.debugDumpDir,
      "01-ncu-normalized.json",
      normalized
    );
  }
  const candidates = await buildCandidates(options.cwd, upgraded);
  sortCandidates(candidates);
  if (options.debugDumpDir) {
    await writeDebugDump(
      options.debugDumpDir,
      "02-candidates-with-current.json",
      candidates
    );
  }

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
  candidates: readonly NextUpdatesCandidate[]
): Map<string, NextUpdatesCandidate[]> {
  const grouped = new Map<string, NextUpdatesCandidate[]>();
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

function formatCandidateLine(candidate: NextUpdatesCandidate): string {
  const current =
    candidate.currentSpec === "" ? "<unknown>" : candidate.currentSpec;

  let typeSuffix = "";
  if (candidate.dependencyType === "devDependencies") {
    typeSuffix = " (dev)";
  }

  return `- \`${candidate.packageName}\`${typeSuffix}: \`${current}\` → \`${candidate.upgradedSpec}\``;
}

export async function writeNextUpdatesReportJson(options: {
  cwd: string;
  fileName: string;
  report: NextUpdatesReport;
}): Promise<string> {
  const outPath = path.resolve(options.cwd, options.fileName);
  await fs.writeFile(outPath, `${JSON.stringify(options.report, null, 2)}\n`);
  return outPath;
}
