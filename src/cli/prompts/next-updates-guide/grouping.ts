import type { WorkspaceEntry, WorkspaceGroup } from "./types";
import {
  escapeRegex,
  formatLabelCase,
  normalizePath,
  toTitleCase,
} from "./utils";

export function buildWorkspaceGroups(
  entries: WorkspaceEntry[]
): WorkspaceGroup[] {
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

export function buildWorkspaceLabel(
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

export function deriveGroupKey(relativePath: string): string {
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

export function formatGroupLabel(groupKey: string): string {
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
