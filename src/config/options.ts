export const scopeValues = ["all", "root", "workspaces"] as const;
export type NextUpdatesScope = (typeof scopeValues)[number];

export const targetValues = ["latest", "minor", "patch"] as const;
export type NextUpdatesTarget = (typeof targetValues)[number];

export const depValues = ["all", "dependencies", "devDependencies"] as const;
export type NextUpdatesDep = (typeof depValues)[number];

export const riskValues = [
  "all",
  "major-only",
  "non-major",
  "prerelease-only",
  "unknown-only",
] as const;
export type NextUpdatesRisk = (typeof riskValues)[number];

export const outputValues = ["prompt", "json"] as const;
export type NextUpdatesOutput = (typeof outputValues)[number];

export type NextUpdatesPromptResult = {
  scope: NextUpdatesScope;
  target: NextUpdatesTarget;
  dep: NextUpdatesDep;
  risk: NextUpdatesRisk;
  output: NextUpdatesOutput;
};
