import fs from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";

export type RootPackageJson = {
  workspaces?: unknown;
  packageManager?: string;
};

type WorkspaceConfig = {
  packages?: unknown;
};

function parseWorkspacesValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (value && typeof value === "object") {
    const packages = (value as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages.filter(
        (entry): entry is string => typeof entry === "string"
      );
    }
  }
  return [];
}

async function readPnpmWorkspace(cwd: string): Promise<WorkspaceConfig | null> {
  try {
    const raw = await fs.readFile(
      path.resolve(cwd, "pnpm-workspace.yaml"),
      "utf8"
    );
    const parsed = parseYaml(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as WorkspaceConfig;
  } catch {
    return null;
  }
}

export async function readRootPackageJson(
  cwd: string
): Promise<RootPackageJson | null> {
  try {
    const raw = await fs.readFile(path.resolve(cwd, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as RootPackageJson;
  } catch {
    return null;
  }
}

export async function detectWorkspacePatterns(
  cwd: string,
  pkg: RootPackageJson | null = null
): Promise<string[]> {
  const patterns: string[] = [];
  const packageJson = pkg ?? (await readRootPackageJson(cwd));
  if (packageJson?.workspaces) {
    patterns.push(...parseWorkspacesValue(packageJson.workspaces));
  }

  const pnpmWorkspace = await readPnpmWorkspace(cwd);
  if (pnpmWorkspace?.packages) {
    patterns.push(...parseWorkspacesValue(pnpmWorkspace.packages));
  }

  return Array.from(
    new Set(patterns.filter((entry) => entry.length > 0))
  ).sort();
}

export async function hasWorkspaceConfig(
  cwd: string,
  pkg: RootPackageJson | null = null
): Promise<boolean> {
  const patterns = await detectWorkspacePatterns(cwd, pkg);
  return patterns.length > 0;
}
