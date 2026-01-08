import type {
  NextUpdatesDep,
  NextUpdatesRisk,
  NextUpdatesScope,
  NextUpdatesTarget,
} from "../../config/options";
import type {
  NextUpdatesEvidence,
  NextUpdatesVersionWindow,
} from "../evidence/collect";

export type NextUpdatesVersionSpec = {
  range: string;
  version: string | null;
};

export type DependencyType = "dependencies" | "devDependencies" | "unknown";

export const dependencyTypeOrder: DependencyType[] = [
  "dependencies",
  "devDependencies",
  "unknown",
];

export type NextUpdatesCandidateBase = {
  packageFile: string;
  dependencyType: DependencyType;
  packageName: string;
  current: NextUpdatesVersionSpec;
  target: NextUpdatesVersionSpec;
};

export type NextUpdatesCandidate = NextUpdatesCandidateBase & {
  versionWindow: NextUpdatesVersionWindow;
  evidence: NextUpdatesEvidence | null;
};

export type NextUpdatesPackageDetails = {
  current: NextUpdatesVersionSpec;
  target: NextUpdatesVersionSpec;
  versionWindow: NextUpdatesVersionWindow;
  evidence: NextUpdatesEvidence | null;
};

export type NextUpdatesPackageGroups = {
  dependencies?: Record<string, NextUpdatesPackageDetails>;
  devDependencies?: Record<string, NextUpdatesPackageDetails>;
  unknown?: Record<string, NextUpdatesPackageDetails>;
};

export type NextUpdatesPackages = Record<string, NextUpdatesPackageGroups>;

export type NextUpdatesReport = {
  generatedAt: string;
  options: {
    scopeRequested: NextUpdatesScope;
    scopeEffective: NextUpdatesScope;
    target: NextUpdatesTarget;
    dep: NextUpdatesDep;
    risk: NextUpdatesRisk;
  };
  packages: NextUpdatesPackages;
};
