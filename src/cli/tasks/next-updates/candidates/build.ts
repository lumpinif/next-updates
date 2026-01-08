import fs from "node:fs/promises";
import path from "node:path";

import type { InstalledVersionLookup } from "../lockfiles";
import type {
  NcuUpgraded,
  NcuUpgradedFlat,
  NcuUpgradedWorkspaces,
} from "../ncu/normalize";
import { isWorkspacesResult } from "../ncu/normalize";
import type { DependencyType, NextUpdatesCandidateBase } from "../types";
import { dependencyTypeOrder } from "../types";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export function buildCandidates(
  cwd: string,
  upgraded: NcuUpgraded,
  installedVersionLookup: InstalledVersionLookup,
  targetVersions: Map<string, string>
): Promise<NextUpdatesCandidateBase[]> {
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
    upgraded as NcuUpgradedFlat,
    installedVersionLookup,
    targetVersions
  );
}

export function sortCandidates<T extends NextUpdatesCandidateBase>(
  candidates: T[]
): void {
  candidates.sort((a, b) => {
    if (a.packageFile !== b.packageFile) {
      return a.packageFile.localeCompare(b.packageFile);
    }
    if (a.dependencyType !== b.dependencyType) {
      return (
        dependencyTypeOrder.indexOf(a.dependencyType) -
        dependencyTypeOrder.indexOf(b.dependencyType)
      );
    }
    return a.packageName.localeCompare(b.packageName);
  });
}

async function buildCandidatesFromWorkspaces(
  cwd: string,
  upgraded: NcuUpgradedWorkspaces,
  installedVersionLookup: InstalledVersionLookup,
  targetVersions: Map<string, string>
): Promise<NextUpdatesCandidateBase[]> {
  const candidates: NextUpdatesCandidateBase[] = [];
  for (const [packageFileRelative, upgradedMap] of Object.entries(upgraded)) {
    const packageFile = path.resolve(cwd, packageFileRelative);
    const packageJson = await readPackageJson(packageFile);

    for (const [packageName, suggestedRange] of Object.entries(upgradedMap)) {
      const { dependencyType, currentRange } = getDependencyTypeAndCurrentRange(
        packageJson,
        packageName
      );
      const installedVersion = installedVersionLookup(
        packageFileRelative,
        packageName,
        currentRange
      );

      candidates.push({
        packageFile: packageFileRelative,
        dependencyType,
        packageName,
        current: {
          range: currentRange,
          version: installedVersion,
        },
        target: {
          range: suggestedRange,
          version: targetVersions.get(packageName) ?? null,
        },
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
): Promise<NextUpdatesCandidateBase[]> {
  const packageFile = path.resolve(cwd, "package.json");
  const packageJson = await readPackageJson(packageFile);
  return Object.entries(upgraded).map(([packageName, suggestedRange]) => {
    const { dependencyType, currentRange } = getDependencyTypeAndCurrentRange(
      packageJson,
      packageName
    );
    const installedVersion = installedVersionLookup(
      "package.json",
      packageName,
      currentRange
    );

    return {
      packageFile: "package.json",
      dependencyType,
      packageName,
      current: {
        range: currentRange,
        version: installedVersion,
      },
      target: {
        range: suggestedRange,
        version: targetVersions.get(packageName) ?? null,
      },
    };
  });
}

function getDependencyTypeAndCurrentRange(
  packageJson: PackageJson,
  packageName: string
): { dependencyType: DependencyType; currentRange: string } {
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

async function readPackageJson(packageFile: string): Promise<PackageJson> {
  const raw = await fs.readFile(packageFile, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid package.json at ${packageFile}`);
  }
  return parsed as PackageJson;
}
