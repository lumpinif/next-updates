import type {
  NextUpdatesCandidate,
  NextUpdatesCandidateBase,
  NextUpdatesPackageDetails,
  NextUpdatesPackages,
} from "../types";

type NextUpdatesPackageDetailsBase = Omit<
  NextUpdatesPackageDetails,
  "versionWindow" | "evidence"
>;

type NextUpdatesPackageGroupsBase = {
  dependencies?: Record<string, NextUpdatesPackageDetailsBase>;
  devDependencies?: Record<string, NextUpdatesPackageDetailsBase>;
  unknown?: Record<string, NextUpdatesPackageDetailsBase>;
};

export type NextUpdatesPackagesBase = Record<
  string,
  NextUpdatesPackageGroupsBase
>;

export function buildPackagesFromBaseCandidates(
  candidates: readonly NextUpdatesCandidateBase[]
): NextUpdatesPackagesBase {
  const packages: NextUpdatesPackagesBase = {};
  for (const candidate of candidates) {
    const fileGroup = packages[candidate.packageFile] ?? {};
    const depGroup = fileGroup[candidate.dependencyType] ?? {};

    depGroup[candidate.packageName] = {
      current: candidate.current,
      target: candidate.target,
    };

    fileGroup[candidate.dependencyType] = depGroup;
    packages[candidate.packageFile] = fileGroup;
  }
  return packages;
}

export function buildPackagesFromCandidates(
  candidates: readonly NextUpdatesCandidate[]
): NextUpdatesPackages {
  const packages: NextUpdatesPackages = {};
  for (const candidate of candidates) {
    const fileGroup = packages[candidate.packageFile] ?? {};
    const depGroup = fileGroup[candidate.dependencyType] ?? {};

    depGroup[candidate.packageName] = {
      current: candidate.current,
      target: candidate.target,
      versionWindow: candidate.versionWindow,
      evidence: candidate.evidence,
    };

    fileGroup[candidate.dependencyType] = depGroup;
    packages[candidate.packageFile] = fileGroup;
  }
  return packages;
}
