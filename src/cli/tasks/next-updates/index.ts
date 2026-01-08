import fs from "node:fs/promises";
import path from "node:path";

import { run as ncuRun } from "npm-check-updates";
import type {
  NextUpdatesDep,
  NextUpdatesRisk,
  NextUpdatesScope,
  NextUpdatesTarget,
} from "../../config/options";
import { collectCandidateEvidence } from "../../evidence";
import {
  hasWorkspaceConfig,
  type RootPackageJson,
  readRootPackageJson,
} from "../../fs/workspaces";
import { buildCandidates, sortCandidates } from "./candidates/build";
import { applyRiskFilter } from "./candidates/filter";
import { writeDebugDump } from "./debug";
import { createInstalledVersionLookup } from "./lockfiles";
import { coerceNcuUpgraded, normalizeNcuResult } from "./ncu/normalize";
import { createRunOptions, createTargetVersionCollector } from "./ncu/run";
import {
  buildPackagesFromBaseCandidates,
  buildPackagesFromCandidates,
} from "./report/build";
import { formatNextUpdatesPromptMarkdown as formatReportMarkdown } from "./report/format";
import type { NextUpdatesReport } from "./types";

export async function collectNextUpdatesReport(options: {
  cwd: string;
  scope: NextUpdatesScope;
  target: NextUpdatesTarget;
  dep: NextUpdatesDep;
  risk: NextUpdatesRisk;
  debugDumpDir?: string;
}): Promise<NextUpdatesReport> {
  const generatedAt = new Date().toISOString();

  const rootPackageJson = await readRootPackageJsonOrThrow(options.cwd);
  const workspacesAvailable = await hasWorkspaceConfig(
    options.cwd,
    rootPackageJson
  );

  const scopeEffective = resolveScopeEffective(
    options.scope,
    workspacesAvailable
  );

  const installedVersionLookup = await createInstalledVersionLookup(
    options.cwd
  );
  const { targetVersions, filterResults } = createTargetVersionCollector();

  const runOptions = createRunOptions(
    options.cwd,
    scopeEffective,
    options.target,
    options.dep
  );
  runOptions.filterResults = filterResults;

  const upgradedRaw = await ncuRun(runOptions);
  const upgraded = coerceNcuUpgraded(upgradedRaw);
  if (options.debugDumpDir) {
    await writeDebugDump(
      options.debugDumpDir,
      "00-ncu-raw.json",
      upgradedRaw ?? null
    );
    const normalized = normalizeNcuResult(upgraded);
    await writeDebugDump(
      options.debugDumpDir,
      "01-ncu-normalized.json",
      normalized
    );
  }

  const candidates = await buildCandidates(
    options.cwd,
    upgraded,
    installedVersionLookup,
    targetVersions
  );
  sortCandidates(candidates);
  const filteredCandidates = applyRiskFilter(candidates, options.risk);
  if (options.debugDumpDir) {
    const packagesWithCurrent =
      buildPackagesFromBaseCandidates(filteredCandidates);
    await writeDebugDump(
      options.debugDumpDir,
      "02-candidates-with-current.json",
      packagesWithCurrent
    );
  }

  const evidenceResults = await collectCandidateEvidence(
    filteredCandidates.map((candidate) => ({
      packageName: candidate.packageName,
      installedVersion: candidate.current.version,
      targetVersion: candidate.target.version,
    }))
  );
  const candidatesWithEvidence = filteredCandidates.map((candidate, index) => ({
    ...candidate,
    ...evidenceResults[index],
  }));
  const packages = buildPackagesFromCandidates(candidatesWithEvidence);
  if (options.debugDumpDir) {
    await writeDebugDump(
      options.debugDumpDir,
      "03-candidates-with-evidence.json",
      packages
    );
  }

  return {
    generatedAt,
    options: {
      scopeRequested: options.scope,
      scopeEffective,
      target: options.target,
      dep: options.dep,
      risk: options.risk,
    },
    packages,
  };
}

export function formatNextUpdatesPromptMarkdown(
  report: NextUpdatesReport
): string {
  return formatReportMarkdown(report);
}

export async function writeNextUpdatesReportJson(options: {
  cwd: string;
  fileName: string;
  report: NextUpdatesReport;
}): Promise<string> {
  const outPath = path.resolve(options.cwd, options.fileName);
  await fs.writeFile(outPath, `${JSON.stringify(options.report, null, 2)}\n`);
  return outPath;
}

async function readRootPackageJsonOrThrow(
  cwd: string
): Promise<RootPackageJson> {
  const rootPackageFile = path.resolve(cwd, "package.json");
  const rootPackageJson = await readRootPackageJson(cwd);
  if (!rootPackageJson) {
    throw new Error(`Invalid package.json at ${rootPackageFile}`);
  }
  return rootPackageJson;
}

function resolveScopeEffective(
  scopeRequested: NextUpdatesScope,
  workspacesAvailable: boolean
): NextUpdatesScope {
  if (workspacesAvailable || scopeRequested === "root") {
    return scopeRequested;
  }
  return "root";
}
