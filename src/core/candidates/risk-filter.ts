import { compare, parse } from "semver";

import type { NextUpdatesRisk } from "../../config/options";
import type { NextUpdatesCandidateBase } from "../report/types";

type RiskGroup =
  | "major"
  | "minor"
  | "patch"
  | "prerelease"
  | "none"
  | "unknown";

export function applyRiskFilter<T extends NextUpdatesCandidateBase>(
  candidates: readonly T[],
  risk: NextUpdatesRisk
): T[] {
  if (risk === "all") {
    return [...candidates];
  }

  return candidates.filter((candidate) => {
    const group = classifyRiskGroup(
      candidate.current.version,
      candidate.target.version
    );
    return matchesRiskFilter(risk, group);
  });
}

function classifyRiskGroup(
  currentVersion: string | null,
  targetVersion: string | null
): RiskGroup {
  if (!(currentVersion && targetVersion)) {
    return "unknown";
  }

  const current = parse(currentVersion);
  const target = parse(targetVersion);
  if (!(current && target)) {
    return "unknown";
  }

  const comparison = compare(current, target);
  if (comparison === 0) {
    return "none";
  }
  if (comparison > 0) {
    return "unknown";
  }

  if (target.prerelease.length > 0) {
    return "prerelease";
  }

  if (target.major > current.major) {
    return "major";
  }
  if (target.minor > current.minor) {
    return "minor";
  }
  if (target.patch > current.patch) {
    return "patch";
  }

  return "none";
}

function matchesRiskFilter(risk: NextUpdatesRisk, group: RiskGroup): boolean {
  switch (risk) {
    case "all":
      return true;
    case "major-only":
      return group === "major";
    case "non-major":
      return group === "minor" || group === "patch" || group === "none";
    case "prerelease-only":
      return group === "prerelease";
    case "unknown-only":
      return group === "unknown";
    default:
      return true;
  }
}
