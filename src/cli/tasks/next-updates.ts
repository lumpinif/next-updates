import fs from "node:fs/promises";
import path from "node:path";

import { run as ncuRun, type RunOptions } from "npm-check-updates";
import { parse as parseYaml } from "yaml";

import type {
  NextUpdatesDep,
  NextUpdatesScope,
  NextUpdatesTarget,
} from "../prompts/next-updates";

export type NextUpdatesCandidate = {
  packageFile: string;
  dependencyType: "dependencies" | "devDependencies" | "unknown";
  packageName: string;
  currentRange: string;
  installedVersion: string | null;
  suggestedRange: string;
  targetVersion: string | null;
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

type PnpmDependencyEntry = { version?: string } | string;

type PnpmImporter = {
  dependencies?: Record<string, PnpmDependencyEntry>;
  devDependencies?: Record<string, PnpmDependencyEntry>;
  optionalDependencies?: Record<string, PnpmDependencyEntry>;
  peerDependencies?: Record<string, PnpmDependencyEntry>;
};

type PnpmLockfile = {
  importers?: Record<string, PnpmImporter>;
};

type PackageLock = {
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version?: string }>;
};

type InstalledVersionLookup = (
  packageFile: string,
  packageName: string
) => string | null;

type FilterResults = NonNullable<RunOptions["filterResults"]>;

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

function createTargetVersionCollector(): {
  targetVersions: Map<string, string>;
  filterResults: FilterResults;
} {
  const targetVersions = new Map<string, string>();
  const filterResults: FilterResults = (packageName, metadata) => {
    if (typeof metadata.upgradedVersion === "string") {
      targetVersions.set(packageName, metadata.upgradedVersion);
    }
    return true;
  };

  return { targetVersions, filterResults };
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

async function createInstalledVersionLookup(
  cwd: string
): Promise<InstalledVersionLookup> {
  const lockfile = await findLockfile(cwd);
  if (lockfile?.type === "pnpm") {
    return createPnpmInstalledVersionLookup(lockfile.path);
  }
  if (lockfile?.type === "npm") {
    return createNpmInstalledVersionLookup(lockfile.path);
  }
  return () => null;
}

async function findLockfile(
  cwd: string
): Promise<{ type: "pnpm" | "npm"; path: string } | null> {
  const candidates: { type: "pnpm" | "npm"; path: string }[] = [
    { type: "pnpm", path: path.resolve(cwd, "pnpm-lock.yaml") },
    { type: "npm", path: path.resolve(cwd, "package-lock.json") },
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate.path);
      return candidate;
    } catch {
      // Ignore missing lockfile candidates.
    }
  }

  return null;
}

async function createPnpmInstalledVersionLookup(
  lockfilePath: string
): Promise<InstalledVersionLookup> {
  try {
    const raw = await fs.readFile(lockfilePath, "utf8");
    const parsed: unknown = parseYaml(raw);
    if (!isRecord(parsed)) {
      return () => null;
    }

    const lockfile = parsed as PnpmLockfile;
    if (!isRecord(lockfile.importers)) {
      return () => null;
    }

    const importers = lockfile.importers as Record<string, PnpmImporter>;
    return (packageFile, packageName) => {
      const importerKey = packageFileToImporterKey(packageFile);
      const importer = importers[importerKey];
      if (!importer) {
        return null;
      }
      return getPnpmImporterVersion(importer, packageName);
    };
  } catch {
    return () => null;
  }
}

function packageFileToImporterKey(packageFile: string): string {
  if (packageFile === "package.json") {
    return ".";
  }
  const normalized = packageFile.split(path.sep).join("/");
  const dir = path.posix.dirname(normalized);
  return dir === "." ? "." : dir;
}

function getPnpmImporterVersion(
  importer: PnpmImporter,
  packageName: string
): string | null {
  return (
    getPnpmVersionEntry(importer.dependencies?.[packageName]) ??
    getPnpmVersionEntry(importer.devDependencies?.[packageName]) ??
    getPnpmVersionEntry(importer.optionalDependencies?.[packageName]) ??
    getPnpmVersionEntry(importer.peerDependencies?.[packageName])
  );
}

function normalizeInstalledVersion(value: string): string {
  const parenIndex = value.indexOf("(");
  if (parenIndex === -1) {
    return value;
  }
  return value.slice(0, parenIndex).trim();
}

function getPnpmVersionEntry(
  entry: PnpmDependencyEntry | undefined
): string | null {
  if (typeof entry === "string") {
    return normalizeInstalledVersion(entry);
  }
  if (entry && typeof entry.version === "string") {
    return normalizeInstalledVersion(entry.version);
  }
  return null;
}

async function createNpmInstalledVersionLookup(
  lockfilePath: string
): Promise<InstalledVersionLookup> {
  try {
    const raw = await fs.readFile(lockfilePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return () => null;
    }

    const lockfile = parsed as PackageLock;
    const packages = isRecord(lockfile.packages)
      ? (lockfile.packages as Record<string, { version?: string }>)
      : null;
    const dependencies = isRecord(lockfile.dependencies)
      ? (lockfile.dependencies as Record<string, { version?: string }>)
      : null;

    return (_packageFile, packageName) => {
      if (packages) {
        const key = path.posix.join("node_modules", packageName);
        const entry = packages[key];
        if (entry && typeof entry.version === "string") {
          return normalizeInstalledVersion(entry.version);
        }
      }

      if (dependencies) {
        const entry = dependencies[packageName];
        if (entry && typeof entry.version === "string") {
          return normalizeInstalledVersion(entry.version);
        }
      }

      return null;
    };
  } catch {
    return () => null;
  }
}

function getDependencyTypeAndCurrentRange(
  packageJson: PackageJson,
  packageName: string
): {
  dependencyType: NextUpdatesCandidate["dependencyType"];
  currentRange: string;
} {
  const fromDeps = packageJson.dependencies?.[packageName];
  if (typeof fromDeps === "string") {
    return { dependencyType: "dependencies", currentRange: fromDeps };
  }

  const fromDevDeps = packageJson.devDependencies?.[packageName];
  if (typeof fromDevDeps === "string") {
    return { dependencyType: "devDependencies", currentRange: fromDevDeps };
  }

  return { dependencyType: "unknown", currentRange: "" };
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
  for (const [packageName, suggestedRange] of entries) {
    if (typeof suggestedRange !== "string") {
      throw new Error("Invalid upgraded dependencies found");
    }
    flat[packageName] = suggestedRange;
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
  suggestedRange: string;
};

function normalizeNcuResult(upgraded: NcuUpgraded): NormalizedNcuCandidate[] {
  if (upgraded === undefined) {
    return [];
  }

  if (isWorkspacesResult(upgraded)) {
    const normalized: NormalizedNcuCandidate[] = [];
    for (const [packageFile, upgrades] of Object.entries(upgraded)) {
      for (const [packageName, suggestedRange] of Object.entries(upgrades)) {
        normalized.push({
          packageFile,
          packageName,
          suggestedRange,
        });
      }
    }
    return normalized;
  }

  return Object.entries(upgraded).map(([packageName, suggestedRange]) => ({
    packageFile: "package.json",
    packageName,
    suggestedRange,
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
  upgraded: NcuUpgradedWorkspaces,
  installedVersionLookup: InstalledVersionLookup,
  targetVersions: Map<string, string>
): Promise<NextUpdatesCandidate[]> {
  const candidates: NextUpdatesCandidate[] = [];
  for (const [packageFileRelative, upgradedMap] of Object.entries(upgraded)) {
    const packageFile = path.resolve(cwd, packageFileRelative);
    const packageJson = await readPackageJson(packageFile);

    for (const [packageName, suggestedRange] of Object.entries(upgradedMap)) {
      const { dependencyType, currentRange } = getDependencyTypeAndCurrentRange(
        packageJson,
        packageName
      );

      candidates.push({
        packageFile: packageFileRelative,
        dependencyType,
        packageName,
        currentRange,
        installedVersion: installedVersionLookup(
          packageFileRelative,
          packageName
        ),
        suggestedRange,
        targetVersion: targetVersions.get(packageName) ?? null,
      });
    }
  }
  return candidates;
}

async function buildCandidatesFromRoot(
  cwd: string,
  upgraded: NcuUpgradedFlat,
  installedVersionLookup: InstalledVersionLookup,
  targetVersions: Map<string, string>
): Promise<NextUpdatesCandidate[]> {
  const packageFile = path.resolve(cwd, "package.json");
  const packageJson = await readPackageJson(packageFile);
  return Object.entries(upgraded).map(([packageName, suggestedRange]) => {
    const { dependencyType, currentRange } = getDependencyTypeAndCurrentRange(
      packageJson,
      packageName
    );

    return {
      packageFile: "package.json",
      dependencyType,
      packageName,
      currentRange,
      installedVersion: installedVersionLookup("package.json", packageName),
      suggestedRange,
      targetVersion: targetVersions.get(packageName) ?? null,
    };
  });
}

function buildCandidates(
  cwd: string,
  upgraded: NcuUpgraded,
  installedVersionLookup: InstalledVersionLookup,
  targetVersions: Map<string, string>
): Promise<NextUpdatesCandidate[]> {
  if (upgraded === undefined) {
    return Promise.resolve([]);
  }

  if (isWorkspacesResult(upgraded)) {
    return buildCandidatesFromWorkspaces(
      cwd,
      upgraded,
      installedVersionLookup,
      targetVersions
    );
  }

  return buildCandidatesFromRoot(
    cwd,
    upgraded,
    installedVersionLookup,
    targetVersions
  );
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

  const installedVersionLookup = await createInstalledVersionLookup(
    options.cwd
  );
  const { targetVersions, filterResults } = createTargetVersionCollector();

  const runOptions = createRunOptions(
    options.cwd,
    scopeEffective,
    options.target,
    options.dep
  );
  runOptions.filterResults = filterResults;

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
  const candidates = await buildCandidates(
    options.cwd,
    upgraded,
    installedVersionLookup,
    targetVersions
  );
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
    candidate.currentRange === "" ? "<unknown>" : candidate.currentRange;
  const installed = candidate.installedVersion ?? "<unknown>";
  const target = candidate.targetVersion ?? "<unknown>";

  let typeSuffix = "";
  if (candidate.dependencyType === "devDependencies") {
    typeSuffix = " (dev)";
  }

  return `- \`${candidate.packageName}\`${typeSuffix}: \`${current}\` → \`${candidate.suggestedRange}\` (installed: \`${installed}\`, target: \`${target}\`)`;
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
