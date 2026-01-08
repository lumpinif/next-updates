import fs from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import type { InstalledVersionLookup } from "./types";
import { normalizeInstalledVersion } from "./utils";

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

export async function createPnpmInstalledVersionLookup(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
