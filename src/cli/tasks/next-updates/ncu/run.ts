import type { RunOptions } from "npm-check-updates";

import type {
  NextUpdatesDep,
  NextUpdatesScope,
  NextUpdatesTarget,
} from "../../../config/options";

type FilterResults = NonNullable<RunOptions["filterResults"]>;

export function createRunOptions(
  cwd: string,
  scope: NextUpdatesScope,
  target: NextUpdatesTarget,
  dep: NextUpdatesDep
): RunOptions {
  let depValue: readonly string[];
  if (dep === "all") {
    depValue = ["prod", "dev"];
  } else if (dep === "dependencies") {
    depValue = ["prod"];
  } else {
    depValue = ["dev"];
  }

  const runOptions: RunOptions = {
    cwd,
    silent: true,
    jsonUpgraded: true,
    target,
    dep: depValue,
  };

  if (scope === "all") {
    runOptions.workspaces = true;
    runOptions.root = true;
  }

  if (scope === "workspaces") {
    runOptions.workspaces = true;
    runOptions.root = false;
  }

  return runOptions;
}

export function createTargetVersionCollector(): {
  targetVersions: Map<string, string>;
  filterResults: FilterResults;
} {
  const targetVersions = new Map<string, string>();
  const filterResults: FilterResults = (packageName, metadata) => {
    if (typeof metadata.upgradedVersion === "string") {
      targetVersions.set(packageName, metadata.upgradedVersion);
    }
    return true;
  };

  return { targetVersions, filterResults };
}
