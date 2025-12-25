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

type BunLockfile = {
  packages?: Record<string, unknown>;
};

type YarnBerryLockfile = Record<string, unknown>;

type InstalledVersionLookup = (
  packageFile: string,
  packageName: string,
  currentRange: string
) => string | null;

type FilterResults = NonNullable<RunOptions["filterResults"]>;

type YarnDescriptorVersion = {
  descriptor: string;
  version: string;
};

type YarnInstalledIndex = Map<string, YarnDescriptorVersion[]>;

const yarnClassicVersionRegex = /^version\s+["'](.+)["']/;
const bunTrailingCommaRegex = /,\s*([}\]])/g;
const lineBreakRegex = /\r?\n/;

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
  if (lockfile?.type === "yarn") {
    return createYarnInstalledVersionLookup(lockfile.path);
  }
  if (lockfile?.type === "bun") {
    return createBunInstalledVersionLookup(lockfile.path);
  }
  return () => null;
}

async function findLockfile(
  cwd: string
): Promise<{ type: "pnpm" | "npm" | "yarn" | "bun"; path: string } | null> {
  const candidates: { type: "pnpm" | "npm" | "yarn" | "bun"; path: string }[] =
    [
      { type: "pnpm", path: path.resolve(cwd, "pnpm-lock.yaml") },
      { type: "npm", path: path.resolve(cwd, "package-lock.json") },
      { type: "yarn", path: path.resolve(cwd, "yarn.lock") },
      { type: "bun", path: path.resolve(cwd, "bun.lock") },
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
    return (packageFile, packageName, _currentRange) => {
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

    return (_packageFile, packageName, _currentRange) => {
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

async function createYarnInstalledVersionLookup(
  lockfilePath: string
): Promise<InstalledVersionLookup> {
  try {
    const raw = await fs.readFile(lockfilePath, "utf8");
    let index: YarnInstalledIndex | null = null;

    if (raw.includes("__metadata:")) {
      try {
        const parsed: unknown = parseYaml(raw);
        if (isRecord(parsed)) {
          index = buildYarnDescriptorIndexFromBerry(
            parsed as YarnBerryLockfile
          );
        }
      } catch {
        index = null;
      }
    }

    if (index === null) {
      index = buildYarnDescriptorIndexFromClassic(raw);
    }

    return createYarnInstalledVersionLookupFromIndex(index);
  } catch {
    return () => null;
  }
}

function createYarnInstalledVersionLookupFromIndex(
  index: YarnInstalledIndex
): InstalledVersionLookup {
  return (_packageFile, packageName, currentRange) => {
    if (currentRange === "") {
      return null;
    }
    const entries = index.get(packageName);
    if (!entries) {
      return null;
    }
    for (const entry of entries) {
      if (matchesYarnDescriptor(entry.descriptor, packageName, currentRange)) {
        return entry.version;
      }
    }
    return null;
  };
}

function buildYarnDescriptorIndexFromBerry(
  lockfile: YarnBerryLockfile
): YarnInstalledIndex {
  const index: YarnInstalledIndex = new Map();
  for (const [descriptorList, entry] of Object.entries(lockfile)) {
    if (descriptorList === "__metadata") {
      continue;
    }
    const version = getYarnEntryVersion(entry);
    if (!version) {
      continue;
    }
    for (const descriptor of splitYarnDescriptorList(descriptorList)) {
      addYarnDescriptorEntry(index, descriptor, version);
    }
  }
  return index;
}

function buildYarnDescriptorIndexFromClassic(raw: string): YarnInstalledIndex {
  const index: YarnInstalledIndex = new Map();
  const lines = raw.split(lineBreakRegex);
  let currentDescriptors: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    if (!line.startsWith(" ")) {
      currentDescriptors = splitYarnKeyLine(line);
      continue;
    }
    if (currentDescriptors.length === 0) {
      continue;
    }
    const match = yarnClassicVersionRegex.exec(trimmed);
    if (!match) {
      continue;
    }
    const version = normalizeInstalledVersion(match[1]);
    for (const descriptor of currentDescriptors) {
      addYarnDescriptorEntry(index, descriptor, version);
    }
  }
  return index;
}

function addYarnDescriptorEntry(
  index: YarnInstalledIndex,
  descriptor: string,
  version: string
): void {
  const packageName = getYarnDescriptorPackageName(descriptor);
  if (!packageName) {
    return;
  }
  const existing = index.get(packageName);
  if (existing) {
    existing.push({ descriptor, version });
    return;
  }
  index.set(packageName, [{ descriptor, version }]);
}

function getYarnDescriptorPackageName(descriptor: string): string | null {
  const atIndex = descriptor.lastIndexOf("@");
  if (atIndex <= 0) {
    return null;
  }
  return descriptor.slice(0, atIndex);
}

function getYarnEntryVersion(entry: unknown): string | null {
  const record = toRecordOrNull(entry);
  if (record === null) {
    return null;
  }
  const version = record.version;
  if (typeof version !== "string") {
    return null;
  }
  return normalizeInstalledVersion(version);
}

function splitYarnKeyLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.endsWith(":")) {
    return [];
  }
  const content = trimmed.slice(0, -1).trim();
  if (content === "") {
    return [];
  }
  return splitYarnDescriptorList(content);
}

function splitYarnDescriptorList(content: string): string[] {
  const descriptors: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of content) {
    if (
      (char === '"' || char === "'") &&
      (quoteChar === "" || char === quoteChar)
    ) {
      if (inQuote) {
        inQuote = false;
        quoteChar = "";
      } else {
        inQuote = true;
        quoteChar = char;
      }
      current += char;
      continue;
    }

    if (char === "," && !inQuote) {
      const trimmed = current.trim();
      if (trimmed !== "") {
        descriptors.push(stripYarnQuotes(trimmed));
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed !== "") {
    descriptors.push(stripYarnQuotes(trimmed));
  }

  return descriptors;
}

function stripYarnQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function matchesYarnDescriptor(
  descriptor: string,
  packageName: string,
  currentRange: string
): boolean {
  if (currentRange === "") {
    return false;
  }
  if (!descriptor.startsWith(`${packageName}@`)) {
    return false;
  }
  const range = descriptor.slice(`${packageName}@`.length);
  if (range === currentRange) {
    return true;
  }
  return range.endsWith(`:${currentRange}`);
}

async function createBunInstalledVersionLookup(
  lockfilePath: string
): Promise<InstalledVersionLookup> {
  try {
    const raw = await fs.readFile(lockfilePath, "utf8");
    const parsed = parseBunLockfile(raw);
    if (!(parsed && isRecord(parsed.packages))) {
      return () => null;
    }

    const packages = parsed.packages as Record<string, unknown>;

    return (_packageFile, packageName, _currentRange) => {
      const entry = packages[packageName];
      if (!Array.isArray(entry) || entry.length === 0) {
        return null;
      }
      return extractBunVersion(entry[0]);
    };
  } catch {
    return () => null;
  }
}

function parseBunLockfile(raw: string): BunLockfile | null {
  try {
    const cleaned = raw.replace(bunTrailingCommaRegex, "$1");
    const parsed: unknown = JSON.parse(cleaned);
    if (!isRecord(parsed)) {
      return null;
    }
    return parsed as BunLockfile;
  } catch {
    return null;
  }
}

function extractBunVersion(entry: unknown): string | null {
  if (typeof entry !== "string") {
    return null;
  }
  const atIndex = entry.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === entry.length - 1) {
    return null;
  }
  return normalizeInstalledVersion(entry.slice(atIndex + 1));
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
          packageName,
          currentRange
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
      installedVersion: installedVersionLookup(
        "package.json",
        packageName,
        currentRange
      ),
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
