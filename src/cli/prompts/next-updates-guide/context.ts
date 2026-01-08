import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  detectWorkspacePatterns,
  readRootPackageJson,
} from "../../fs/workspaces";
import {
  buildWorkspaceGroups,
  buildWorkspaceLabel,
  deriveGroupKey,
  formatGroupLabel,
} from "./grouping";
import type { NextUpdatesGuideContext, WorkspaceEntry } from "./types";
import { escapeRegex, normalizePath } from "./utils";

const lockfileMap = [
  { name: "pnpm", file: "pnpm-lock.yaml" },
  { name: "npm", file: "package-lock.json" },
  { name: "yarn", file: "yarn.lock" },
  { name: "bun", file: "bun.lock" },
  { name: "bun", file: "bun.lockb" },
] as const;

const trailingSlashRegex = /\/+$/;

export async function collectNextUpdatesGuideContext(
  cwd: string
): Promise<NextUpdatesGuideContext> {
  const packageManager = await detectPackageManager(cwd);
  const workspaces = await detectWorkspacePatterns(cwd);
  const repoSizeHint =
    workspaces.length > 0 ? resolveRepoSizeHint(workspaces) : undefined;
  const workspaceEntries = await collectWorkspaceEntries(cwd);
  const workspaceGroups = buildWorkspaceGroups(workspaceEntries);

  return {
    repoName: path.basename(cwd),
    packageManager,
    workspaces: workspaces.length > 0 ? workspaces : undefined,
    workspaceEntries:
      workspaceEntries.length > 0 ? workspaceEntries : undefined,
    workspaceGroups: workspaceGroups.length > 0 ? workspaceGroups : undefined,
    repoSizeHint,
  };
}

async function detectPackageManager(cwd: string): Promise<string | undefined> {
  const pkg = await readRootPackageJson(cwd);
  if (pkg?.packageManager) {
    const raw = pkg.packageManager;
    if (raw.startsWith("pnpm")) {
      return "pnpm";
    }
    if (raw.startsWith("npm")) {
      return "npm";
    }
    if (raw.startsWith("yarn")) {
      return "yarn";
    }
    if (raw.startsWith("bun")) {
      return "bun";
    }
  }

  for (const candidate of lockfileMap) {
    try {
      await fs.access(path.resolve(cwd, candidate.file));
      return candidate.name;
    } catch {
      // Ignore missing lockfiles.
    }
  }

  return;
}

function resolveRepoSizeHint(workspaces: string[]): "small" | "large" {
  if (workspaces.length >= 4) {
    return "large";
  }
  if (workspaces.some((entry) => entry.includes("*"))) {
    return "large";
  }
  return "small";
}

async function collectWorkspaceEntries(cwd: string): Promise<WorkspaceEntry[]> {
  const patterns = await detectWorkspacePatterns(cwd);
  if (patterns.length === 0) {
    return [];
  }
  const workspacePaths = await resolveWorkspacePaths(cwd, patterns);
  const entries = await Promise.all(
    workspacePaths.map((workspacePath) =>
      readWorkspaceEntry(cwd, workspacePath, workspacePaths)
    )
  );
  return entries.filter((entry): entry is WorkspaceEntry => entry !== null);
}

async function resolveWorkspacePaths(
  cwd: string,
  patterns: string[]
): Promise<string[]> {
  const resolved = new Set<string>();
  for (const pattern of patterns) {
    const matches = await resolveWorkspacePattern(cwd, pattern);
    for (const match of matches) {
      resolved.add(match);
    }
  }
  return Array.from(resolved).sort();
}

async function resolveWorkspacePattern(
  cwd: string,
  pattern: string
): Promise<string[]> {
  const normalized = normalizePath(pattern);
  if (!normalized.includes("*")) {
    const workspacePath = path.resolve(cwd, normalized);
    if (await hasPackageJson(workspacePath)) {
      return [normalized];
    }
    return [];
  }

  const patternSegments = normalized.split("/").filter(Boolean);
  const wildcardIndex = patternSegments.findIndex((segment) =>
    segment.includes("*")
  );
  const baseSegments =
    wildcardIndex === -1
      ? patternSegments
      : patternSegments.slice(0, wildcardIndex);
  const baseDir = path.resolve(cwd, baseSegments.join("/"));
  if (!(await existsDir(baseDir))) {
    return [];
  }

  const maxDepth = Math.max(patternSegments.length + 2, 4);
  const candidateDirs = await walkWorkspaceDirs(baseDir, maxDepth);
  const matches: string[] = [];
  for (const dir of candidateDirs) {
    const relative = normalizePath(path.relative(cwd, dir));
    if (matchGlob(patternSegments, relative.split("/"))) {
      matches.push(relative);
    }
  }
  return matches;
}

async function walkWorkspaceDirs(
  baseDir: string,
  maxDepth: number
): Promise<string[]> {
  const results: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [
    { dir: baseDir, depth: 0 },
  ];
  const visited = new Set<string>();
  const maxEntries = 500;

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      break;
    }
    if (!shouldProcessDir(next, visited, maxDepth)) {
      continue;
    }
    visited.add(next.dir);
    if (await hasPackageJson(next.dir)) {
      results.push(next.dir);
    }
    if (next.depth === maxDepth) {
      continue;
    }
    const children = await readChildDirs(next.dir);
    enqueueChildren({
      queue,
      visited,
      children,
      depth: next.depth,
      maxEntries,
    });
  }

  return results;
}

function shouldProcessDir(
  item: { dir: string; depth: number },
  visited: Set<string>,
  maxDepth: number
): boolean {
  if (visited.has(item.dir)) {
    return false;
  }
  return item.depth <= maxDepth;
}

async function readChildDirs(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !shouldSkipDir(name))
    .map((name) => path.join(dir, name));
}

function enqueueChildren(options: {
  queue: Array<{ dir: string; depth: number }>;
  visited: Set<string>;
  children: string[];
  depth: number;
  maxEntries: number;
}): void {
  const { queue, visited, children, depth, maxEntries } = options;
  for (const child of children) {
    if (visited.has(child)) {
      continue;
    }
    if (queue.length >= maxEntries) {
      break;
    }
    queue.push({ dir: child, depth: depth + 1 });
  }
}

async function readWorkspaceEntry(
  cwd: string,
  relativePath: string,
  allWorkspacePaths: string[]
): Promise<WorkspaceEntry | null> {
  const packageJsonPath = path.resolve(cwd, relativePath, "package.json");
  const pkg = await readWorkspacePackageJson(packageJsonPath);
  if (!pkg) {
    return null;
  }
  const hasChildWorkspace = hasChildWorkspacePath(
    relativePath,
    allWorkspacePaths
  );
  if (hasChildWorkspace && !hasWorkspaceSignal(pkg)) {
    return null;
  }
  const repoName = path.basename(cwd);
  const label = buildWorkspaceLabel(pkg, repoName, relativePath);
  const groupKey = deriveGroupKey(relativePath);
  const groupLabel = formatGroupLabel(groupKey);
  return {
    path: relativePath,
    label,
    groupKey,
    groupLabel,
  };
}

async function readWorkspacePackageJson(packageJsonPath: string): Promise<{
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
} | null> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const pkg = parsed as {
      name?: string;
      description?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    return {
      name: pkg.name,
      description: pkg.description,
      dependencies: pkg.dependencies,
      devDependencies: pkg.devDependencies,
      peerDependencies: pkg.peerDependencies,
      scripts: pkg.scripts,
    };
  } catch {
    return null;
  }
}

function hasChildWorkspacePath(
  relativePath: string,
  allWorkspacePaths: string[]
): boolean {
  const prefix = `${relativePath.replace(trailingSlashRegex, "")}/`;
  for (const candidate of allWorkspacePaths) {
    if (candidate !== relativePath && candidate.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function hasWorkspaceSignal(pkg: {
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}): boolean {
  if (pkg.description && pkg.description.trim().length > 0) {
    return true;
  }
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    return true;
  }
  if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
    return true;
  }
  if (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length > 0) {
    return true;
  }
  if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
    return true;
  }
  return false;
}

function matchGlob(patternSegments: string[], pathSegments: string[]): boolean {
  if (patternSegments.length === 0) {
    return pathSegments.length === 0;
  }
  const [pattern, ...rest] = patternSegments;
  if (pattern === "**") {
    if (matchGlob(rest, pathSegments)) {
      return true;
    }
    return pathSegments.some((_, index) =>
      matchGlob(rest, pathSegments.slice(index + 1))
    );
  }
  if (pattern.includes("*")) {
    if (pathSegments.length === 0) {
      return false;
    }
    const regex = new RegExp(
      `^${pattern.split("*").map(escapeRegex).join(".*")}$`,
      "i"
    );
    if (!regex.test(pathSegments[0] ?? "")) {
      return false;
    }
    return matchGlob(rest, pathSegments.slice(1));
  }
  if (pathSegments.length === 0) {
    return false;
  }
  if (pattern !== pathSegments[0]) {
    return false;
  }
  return matchGlob(rest, pathSegments.slice(1));
}

async function hasPackageJson(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, "package.json"));
    return true;
  } catch {
    return false;
  }
}

async function existsDir(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function shouldSkipDir(name: string): boolean {
  return (
    name.startsWith(".") ||
    name === "node_modules" ||
    name === "dist" ||
    name === "build" ||
    name === "out" ||
    name === "coverage"
  );
}
