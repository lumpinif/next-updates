import fs from "node:fs/promises";
import path from "node:path";

import type { InstalledVersionLookup } from "./types";
import { normalizeInstalledVersion } from "./utils";

type PackageLock = {
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version?: string }>;
};

export async function createNpmInstalledVersionLookup(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
