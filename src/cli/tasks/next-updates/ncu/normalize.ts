export type NcuUpgradedFlat = Record<string, string>;
export type NcuUpgradedWorkspaces = Record<string, NcuUpgradedFlat>;
export type NcuUpgraded = NcuUpgradedFlat | NcuUpgradedWorkspaces | undefined;

export type NormalizedNcuCandidate = {
  packageFile: string;
  packageName: string;
  suggestedRange: string;
};

type RecordEntry = [string, unknown];

export function coerceNcuUpgraded(result: unknown): NcuUpgraded {
  if (result === undefined) {
    return;
  }

  const record = toRecordOrNull(result);
  if (record === null) {
    throw new Error("Invalid upgraded dependencies found");
  }

  const entries = Object.entries(record);
  if (entries.length === 0) {
    return {};
  }

  if (looksLikeWorkspaces(entries)) {
    return coerceWorkspaces(entries);
  }

  return coerceFlat(entries);
}

export function normalizeNcuResult(
  upgraded: NcuUpgraded
): NormalizedNcuCandidate[] {
  if (upgraded === undefined) {
    return [];
  }

  if (isWorkspacesResult(upgraded)) {
    const normalized: NormalizedNcuCandidate[] = [];
    for (const [packageFile, upgrades] of Object.entries(upgraded)) {
      for (const [packageName, suggestedRange] of Object.entries(upgrades)) {
        normalized.push({
          packageFile,
          packageName,
          suggestedRange,
        });
      }
    }
    return normalized;
  }

  return Object.entries(upgraded).map(([packageName, suggestedRange]) => ({
    packageFile: "package.json",
    packageName,
    suggestedRange,
  }));
}

export function isWorkspacesResult(
  result: unknown
): result is NcuUpgradedWorkspaces {
  if (typeof result !== "object" || result === null) {
    return false;
  }

  for (const value of Object.values(result as Record<string, unknown>)) {
    if (typeof value === "object" && value !== null) {
      return true;
    }
  }

  return false;
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function looksLikeWorkspaces(entries: RecordEntry[]): boolean {
  return entries.some(([key]) => key.endsWith("package.json"));
}

function coerceWorkspaces(entries: RecordEntry[]): NcuUpgradedWorkspaces {
  const workspaces: NcuUpgradedWorkspaces = {};
  for (const [packageFile, upgrades] of entries) {
    const upgradesRecord = toRecordOrNull(upgrades);
    if (upgradesRecord === null) {
      throw new Error("Invalid upgraded dependencies found");
    }
    workspaces[packageFile] = coerceFlat(Object.entries(upgradesRecord));
  }
  return workspaces;
}

function coerceFlat(entries: RecordEntry[]): NcuUpgradedFlat {
  const flat: NcuUpgradedFlat = {};
  for (const [packageName, suggestedRange] of entries) {
    if (typeof suggestedRange !== "string") {
      throw new Error("Invalid upgraded dependencies found");
    }
    flat[packageName] = suggestedRange;
  }
  return flat;
}
