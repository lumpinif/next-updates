import fs from "node:fs/promises";

import type { InstalledVersionLookup } from "./types";
import { normalizeInstalledVersion } from "./utils";

type BunLockfile = {
  packages?: Record<string, unknown>;
};

const bunTrailingCommaRegex = /,\s*([}\]])/g;

export async function createBunInstalledVersionLookup(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
