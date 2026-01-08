import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { detectWorkspacePatterns, readRootPackageJson } from "../fs/workspaces";

type WorkspaceEntry = {
  path: string;
  label: string;
  groupKey: string;
  groupLabel: string;
};

type WorkspaceGroup = {
  key: string;
  label: string;
  entries: WorkspaceEntry[];
};

export type NextUpdatesGuideContext = {
  repoName?: string;
  packageManager?: string;
  workspaces?: string[];
  workspaceEntries?: WorkspaceEntry[];
  workspaceGroups?: WorkspaceGroup[];
  repoSizeHint?: "small" | "large";
};

const lockfileMap = [
  { name: "pnpm", file: "pnpm-lock.yaml" },
  { name: "npm", file: "package-lock.json" },
  { name: "yarn", file: "yarn.lock" },
  { name: "bun", file: "bun.lock" },
  { name: "bun", file: "bun.lockb" },
] as const;

const titleCaseSplitRegex = /[\s_-]+/;
const mixedCaseRegex = /[A-Z]/;
const trailingSlashRegex = /\/+$/;

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

export function formatNextUpdatesGuidePromptMarkdown(
  context: NextUpdatesGuideContext
): string {
  const lines: string[] = [
    "# next-updates agent guide",
    "",
    "## How to run next-updates",
    "",
    "If you are a human:",
    "- Copy this prompt into your coding agent (Cursor/Claude/ChatGPT).",
    "- Or run the interactive UI:",
    "",
    "```bash",
    "npx next-updates@latest --interactive",
    "```",
    "",
    "If you are an agent:",
    "1. Start with a 1-2 sentence intro in plain words (what next-updates does and what you will do).",
    "2. Ask the user for options with plain meanings and a recommendation.",
    "3. Keep the questions tailored to the repo (use detected workspaces).",
    "4. Use output=prompt by default. Only ask for JSON if the user wants it.",
    "5. Before summarizing, scan the repo to confirm usage (imports, scripts, configs).",
    "6. Run next-updates with flags:",
    "",
    "```bash",
    "npx next-updates@latest --scope <all|root|workspaces> --target <latest|minor|patch> --dep <all|dependencies|devDependencies> --risk <all|major-only|non-major|prerelease-only|unknown-only> --output <prompt|json>",
    "```",
    "",
    "7. If output is json, read `next-updates-report.json` from the project root.",
    "8. Use evidence links (changelog, releases, compare) to collect facts.",
    "9. If evidence links are missing, find them via registry metadata or the repo; only ask the user if blocked.",
    "10. Summarize what to update and why in simple words. Do not change code unless asked.",
    "11. If the user asks to dig into one package, switch to a short deep-dive response (see Output rules).",
  ];

  const detectedLines = formatDetectedContext(context);
  if (detectedLines.length > 0) {
    lines.push("", "Detected context:", ...detectedLines);
  }

  const guidanceLines = formatGuidance(context);
  lines.push("", "Ask options in plain words:");
  lines.push(...guidanceLines);

  lines.push(
    "",
    "Output rules:",
    "- Keep it short and easy to read. Use simple words.",
    "- Two sections: Worth upgrading now, Can wait.",
    "- For each package, write two short lines:",
    "  - Change: include one technical term plus one plain sentence.",
    "  - Impact: why this matters for the repo, in plain words.",
    "- Write like a helpful teammate, not a template. Avoid filler.",
    "- Group related packages with the same change to avoid repetition.",
    "- Do not list evidence links unless the user asks for sources.",
    "- Do not include file paths or tool logs. Mention usage by area (API, UI, worker).",
    "- Use evidence to form your summary. If you cannot find evidence, say so.",
    "- Focus on user impact: new features, critical fixes, and new capabilities.",
    "- Mention breaking changes, deprecations, and security first.",
    "- Use repo signals to mention frameworks/ecosystems when helpful.",
    "- Do not assume a stack if it is not detected.",
    "- Do not show upgrade commands unless the user asks.",
    "- Only claim impact when usage is confirmed in the repo; otherwise say it is not detected.",
    "- Deep dive (single package):",
    "  - One-line recommendation (upgrade now / wait / try in a small area).",
    "  - Key changes: 2-3 short bullets.",
    "  - Risks/unknowns: 1-2 short bullets.",
    "  - Next step: 1 optional action (sample diff, run a check).",
    "- Output must be in English."
  );

  return `${lines.join("\n")}\n`;
}

function formatDetectedContext(context: NextUpdatesGuideContext): string[] {
  const lines: string[] = [];
  if (context.repoName) {
    lines.push(`- Repo: ${context.repoName}`);
  }
  if (context.packageManager) {
    lines.push(`- Package manager: ${context.packageManager}`);
  }
  if (context.workspaces && context.workspaces.length > 0) {
    const preview = formatWorkspacePreview(context.workspaces);
    lines.push(`- Workspaces: ${preview}`);
  }
  if (context.repoSizeHint) {
    lines.push(`- Repo size: ${context.repoSizeHint}`);
  }
  return lines;
}

function formatGuidance(context: NextUpdatesGuideContext): string[] {
  const workspaceGroups = context.workspaceGroups ?? [];
  const lines: string[] = [];
  const recommendation = buildRecommendation(context);
  const repoLabel = context.repoName ?? "this repo";

  lines.push("- Use the question below as-is:");
  lines.push("```text");
  lines.push(
    ...formatSuggestedQuestion({
      repoLabel,
      workspaceGroups,
      recommendation,
      repoSizeHint: context.repoSizeHint,
    })
  );
  lines.push("```");
  lines.push("");
  lines.push(
    "- If the user wants to tweak later, map their plain answer to flags."
  );

  return lines;
}

function formatWorkspacePreview(workspaces: string[]): string {
  const maxPreview = 4;
  const preview = workspaces.slice(0, maxPreview);
  const extraCount = workspaces.length - preview.length;
  if (extraCount <= 0) {
    return preview.join(", ");
  }
  return `${preview.join(", ")}, +${extraCount} more`;
}

function buildRecommendation(context: NextUpdatesGuideContext): {
  scope: "root" | "workspaces" | "all";
  target: "latest" | "minor" | "patch";
  dep: "dependencies" | "devDependencies" | "all";
  risk: "major-only" | "all" | "non-major" | "prerelease-only" | "unknown-only";
} {
  const hasWorkspaces =
    context.workspaces !== undefined && context.workspaces.length > 0;

  if (context.repoSizeHint === "large" && hasWorkspaces) {
    return {
      scope: "workspaces",
      target: "latest",
      dep: "dependencies",
      risk: "major-only",
    };
  }

  if (context.repoSizeHint === "small" && hasWorkspaces) {
    return {
      scope: "all",
      target: "latest",
      dep: "dependencies",
      risk: "all",
    };
  }

  return {
    scope: "root",
    target: "latest",
    dep: "dependencies",
    risk: "all",
  };
}

function formatSuggestedQuestion(options: {
  repoLabel: string;
  workspaceGroups: WorkspaceGroup[];
  recommendation: {
    scope: "root" | "workspaces" | "all";
    target: "latest" | "minor" | "patch";
    dep: "dependencies" | "devDependencies" | "all";
    risk:
      | "major-only"
      | "all"
      | "non-major"
      | "prerelease-only"
      | "unknown-only";
  };
  repoSizeHint?: "small" | "large";
}): string[] {
  const { repoLabel, workspaceGroups, recommendation, repoSizeHint } = options;
  const lines: string[] = [];
  lines.push(
    "next-updates reads the repo, then summarizes upgrades that matter."
  );
  lines.push(
    `I'll scan ${repoLabel} and return a short guide: what to do now vs later.`
  );

  if (repoSizeHint === "large") {
    lines.push("Large repo, start small.");
  }
  if (repoSizeHint === "small") {
    lines.push("Small repo, start broad.");
  }

  lines.push(
    `Recommended: ${formatRecommendationSentence(
      recommendation,
      repoLabel,
      workspaceGroups
    )}.`
  );
  lines.push('Reply with "use recommended", or answer in plain words:');
  lines.push(...formatWhereToStartQuestionLines(repoLabel, workspaceGroups));
  lines.push(...formatChangeSizeQuestionLines());
  lines.push(...formatDepsQuestionLines());

  return lines;
}

function formatRecommendationSentence(
  recommendation: {
    scope: "root" | "workspaces" | "all";
    target: "latest" | "minor" | "patch";
    dep: "dependencies" | "devDependencies" | "all";
    risk:
      | "major-only"
      | "all"
      | "non-major"
      | "prerelease-only"
      | "unknown-only";
  },
  repoLabel: string,
  workspaceGroups: WorkspaceGroup[]
): string {
  const scopeText = buildScopeSentence(
    recommendation.scope,
    repoLabel,
    workspaceGroups
  );
  const changeText = buildChangeSentence(recommendation);
  const depText = buildDepSentence(recommendation.dep);
  return `${scopeText}, ${changeText}, ${depText}`;
}

function buildScopeSentence(
  scope: "root" | "workspaces" | "all",
  repoLabel: string,
  workspaceGroups: WorkspaceGroup[]
): string {
  if (scope === "root") {
    return `root tools (${repoLabel}/package.json)`;
  }
  if (scope === "all") {
    return "everything (root + all workspaces)";
  }
  const examples = formatScopeExamples(workspaceGroups);
  return `workspaces (all sub-projects${examples})`;
}

function buildChangeSentence(recommendation: {
  target: "latest" | "minor" | "patch";
  risk: "major-only" | "all" | "non-major" | "prerelease-only" | "unknown-only";
}): string {
  if (recommendation.risk === "major-only") {
    return "big changes (major)";
  }
  if (recommendation.target === "minor") {
    return "balanced (major + minor)";
  }
  if (recommendation.target === "patch") {
    return "safer (minor + patch)";
  }
  return "all changes";
}

function buildDepSentence(
  dep: "dependencies" | "devDependencies" | "all"
): string {
  if (dep === "dependencies") {
    return "runtime deps (dependencies)";
  }
  if (dep === "devDependencies") {
    return "dev tools (devDependencies)";
  }
  return "runtime + dev tools (dependencies + devDependencies)";
}

function formatWhereToStartQuestionLines(
  repoLabel: string,
  groups: WorkspaceGroup[]
): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("1) Where should I start?");
  lines.push(`- Root tools (${repoLabel}/package.json)`);
  const examples = formatScopeExamples(groups);
  lines.push(`- Workspaces (all sub-projects${examples})`);
  lines.push("- Everything (root + all workspaces)");
  return lines;
}

function formatChangeSizeQuestionLines(): string[] {
  return [
    "",
    "2) How aggressive? (version jump size)",
    "- Big changes only (major)",
    "- Balanced (major + minor)",
    "- Safer (minor + patch)",
  ];
}

function formatDepsQuestionLines(): string[] {
  return [
    "",
    "3) Which deps?",
    "- Runtime only (dependencies)",
    "- Runtime + dev tools (dependencies + devDependencies)",
  ];
}

function pickFocusGroups(groups: WorkspaceGroup[]): string[] {
  const preferred = ["Workers", "Apps", "Services", "API", "Web", "Backend"];
  const ranked = groups
    .map((group) => ({
      group,
      score: preferred.some((label) =>
        getGroupDisplayLabel(group).toLowerCase().includes(label.toLowerCase())
      )
        ? 1
        : 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.group.entries.length - a.group.entries.length;
    })
    .map((item) => getGroupDisplayLabel(item.group));

  return ranked.slice(0, 2);
}

function formatScopeExamples(groups: WorkspaceGroup[]): string {
  const examples = pickFocusGroups(groups);
  if (examples.length === 0) {
    return "";
  }
  return `, like ${examples.join(", ")}`;
}

function getGroupDisplayLabel(group: WorkspaceGroup): string {
  if (group.entries.length === 1) {
    const entry = group.entries[0];
    if (entry) {
      return entry.label;
    }
  }
  return group.label;
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

function buildWorkspaceLabel(
  pkg: { name?: string; description?: string },
  repoName: string,
  relativePath: string
): string {
  if (pkg.description) {
    const cleaned = cleanLabel(pkg.description, repoName);
    if (cleaned.length > 0) {
      return formatLabelCase(cleaned);
    }
  }

  const name = pkg.name?.startsWith("@") ? pkg.name.split("/")[1] : pkg.name;
  if (name) {
    return toTitleCase(name);
  }

  const fallback = relativePath.split("/").pop();
  return fallback ? toTitleCase(fallback) : relativePath;
}

function formatLabelCase(label: string): string {
  const hasMixedCase = mixedCaseRegex.test(label.slice(1));
  return hasMixedCase ? label : toTitleCase(label);
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

function cleanLabel(label: string, repoName: string): string {
  let cleaned = label.trim();
  if (repoName) {
    const repoPattern = escapeRegex(repoName);
    cleaned = cleaned.replace(
      new RegExp(`\\s+for\\s+@?${repoPattern}\\b`, "gi"),
      ""
    );
    cleaned = cleaned.replace(new RegExp(`\\b@?${repoPattern}\\b`, "gi"), "");
  }
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

function toTitleCase(input: string): string {
  return input
    .split(titleCaseSplitRegex)
    .filter((part) => part.length > 0)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["api", "ui", "db", "sdk", "v0", "v1", "v2", "id"].includes(lower)) {
        return lower.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function deriveGroupKey(relativePath: string): string {
  const segments = normalizePath(relativePath).split("/").filter(Boolean);
  if (segments.length === 0) {
    return relativePath;
  }
  const root = segments[0] ?? relativePath;
  const second = segments[1] ?? "";
  const rootKey = normalizeRootKey(root);
  if (rootKey === "apps") {
    return resolveAppsGroupKey(second);
  }
  if (rootKey === "packages") {
    return resolvePackagesGroupKey(second);
  }
  if (rootKey === "services") {
    return "services";
  }
  if (rootKey === "libs") {
    return "libs";
  }
  return root;
}

function normalizeRootKey(root: string): string {
  if (root === "app" || root === "apps") {
    return "apps";
  }
  if (root === "package" || root === "packages") {
    return "packages";
  }
  if (root === "service" || root === "services") {
    return "services";
  }
  if (root === "lib" || root === "libs") {
    return "libs";
  }
  return root;
}

function resolveAppsGroupKey(second: string): string {
  if (second === "workers" || second === "worker") {
    return "apps/workers";
  }
  return "apps";
}

function resolvePackagesGroupKey(second: string): string {
  if (second === "db" || second === "database") {
    return "packages/db";
  }
  if (second === "sdk" || second === "sdks") {
    return "packages/sdks";
  }
  return "packages/shared";
}

function formatGroupLabel(groupKey: string): string {
  const lowered = groupKey.toLowerCase();
  if (lowered === "packages/shared") {
    return "Shared packages";
  }
  if (lowered.includes("workers")) {
    return "Workers";
  }
  if (lowered.includes("apps")) {
    return "Apps";
  }
  if (lowered.includes("services")) {
    return "Services";
  }
  if (lowered.includes("db")) {
    return "Databases";
  }
  if (lowered.includes("sdk")) {
    return "SDK";
  }
  if (lowered.includes("ui")) {
    return "UI";
  }
  if (lowered.includes("packages")) {
    return "Packages";
  }
  return toTitleCase(groupKey.replace("/", " "));
}

function buildWorkspaceGroups(entries: WorkspaceEntry[]): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();
  for (const entry of entries) {
    const existing = groups.get(entry.groupKey);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    groups.set(entry.groupKey, {
      key: entry.groupKey,
      label: entry.groupLabel,
      entries: [entry],
    });
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (b.entries.length !== a.entries.length) {
      return b.entries.length - a.entries.length;
    }
    return a.label.localeCompare(b.label);
  });
}

function normalizePath(input: string): string {
  return input.replaceAll("\\", "/");
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
