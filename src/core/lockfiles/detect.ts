import fs from "node:fs/promises";
import path from "node:path";

import { createBunInstalledVersionLookup } from "./bun";
import { createNpmInstalledVersionLookup } from "./npm";
import { createPnpmInstalledVersionLookup } from "./pnpm";
import type { InstalledVersionLookup as InstalledVersionLookupType } from "./types";
import { createYarnInstalledVersionLookup } from "./yarn";

type LockfileType = "pnpm" | "npm" | "yarn" | "bun";

export async function createInstalledVersionLookup(
  cwd: string
): Promise<InstalledVersionLookupType> {
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
): Promise<{ type: LockfileType; path: string } | null> {
  const candidates: { type: LockfileType; path: string }[] = [
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

export type { InstalledVersionLookup } from "./types";
