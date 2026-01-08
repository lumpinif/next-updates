import fs from "node:fs/promises";

import { parse as parseYaml } from "yaml";

import type { InstalledVersionLookup } from "./types";
import { normalizeInstalledVersion } from "./utils";

type YarnBerryLockfile = Record<string, unknown>;

type YarnDescriptorVersion = {
  descriptor: string;
  version: string;
};

type YarnInstalledIndex = Map<string, YarnDescriptorVersion[]>;

const yarnClassicVersionRegex = /^version\s+["'](.+)["']/;
const lineBreakRegex = /\r?\n/;

export async function createYarnInstalledVersionLookup(
  lockfilePath: string
): Promise<InstalledVersionLookup> {
  try {
    const raw = await fs.readFile(lockfilePath, "utf8");
    let index: YarnInstalledIndex | null = null;

    if (raw.includes("__metadata:")) {
      try {
        const parsed: unknown = parseYaml(raw);
        if (isRecord(parsed)) {
          index = buildYarnDescriptorIndexFromBerry(
            parsed as YarnBerryLockfile
          );
        }
      } catch {
        index = null;
      }
    }

    if (index === null) {
      index = buildYarnDescriptorIndexFromClassic(raw);
    }

    return createYarnInstalledVersionLookupFromIndex(index);
  } catch {
    return () => null;
  }
}

function createYarnInstalledVersionLookupFromIndex(
  index: YarnInstalledIndex
): InstalledVersionLookup {
  return (_packageFile, packageName, currentRange) => {
    if (currentRange === "") {
      return null;
    }
    const entries = index.get(packageName);
    if (!entries) {
      return null;
    }
    for (const entry of entries) {
      if (matchesYarnDescriptor(entry.descriptor, packageName, currentRange)) {
        return entry.version;
      }
    }
    return null;
  };
}

function buildYarnDescriptorIndexFromBerry(
  lockfile: YarnBerryLockfile
): YarnInstalledIndex {
  const index: YarnInstalledIndex = new Map();
  for (const [descriptorList, entry] of Object.entries(lockfile)) {
    if (descriptorList === "__metadata") {
      continue;
    }
    const version = getYarnEntryVersion(entry);
    if (!version) {
      continue;
    }
    for (const descriptor of splitYarnDescriptorList(descriptorList)) {
      addYarnDescriptorEntry(index, descriptor, version);
    }
  }
  return index;
}

function buildYarnDescriptorIndexFromClassic(raw: string): YarnInstalledIndex {
  const index: YarnInstalledIndex = new Map();
  const lines = raw.split(lineBreakRegex);
  let currentDescriptors: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    if (!line.startsWith(" ")) {
      currentDescriptors = splitYarnKeyLine(line);
      continue;
    }
    if (currentDescriptors.length === 0) {
      continue;
    }
    const match = yarnClassicVersionRegex.exec(trimmed);
    if (!match) {
      continue;
    }
    const version = normalizeInstalledVersion(match[1]);
    for (const descriptor of currentDescriptors) {
      addYarnDescriptorEntry(index, descriptor, version);
    }
  }
  return index;
}

function addYarnDescriptorEntry(
  index: YarnInstalledIndex,
  descriptor: string,
  version: string
): void {
  const packageName = getYarnDescriptorPackageName(descriptor);
  if (!packageName) {
    return;
  }
  const existing = index.get(packageName);
  if (existing) {
    existing.push({ descriptor, version });
    return;
  }
  index.set(packageName, [{ descriptor, version }]);
}

function getYarnDescriptorPackageName(descriptor: string): string | null {
  const atIndex = descriptor.lastIndexOf("@");
  if (atIndex <= 0) {
    return null;
  }
  return descriptor.slice(0, atIndex);
}

function getYarnEntryVersion(entry: unknown): string | null {
  const record = toRecordOrNull(entry);
  if (record === null) {
    return null;
  }
  const version = record.version;
  if (typeof version !== "string") {
    return null;
  }
  return normalizeInstalledVersion(version);
}

function splitYarnKeyLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.endsWith(":")) {
    return [];
  }
  const content = trimmed.slice(0, -1).trim();
  if (content === "") {
    return [];
  }
  return splitYarnDescriptorList(content);
}

function splitYarnDescriptorList(content: string): string[] {
  const descriptors: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of content) {
    if (
      (char === '"' || char === "'") &&
      (quoteChar === "" || char === quoteChar)
    ) {
      if (inQuote) {
        inQuote = false;
        quoteChar = "";
      } else {
        inQuote = true;
        quoteChar = char;
      }
      current += char;
      continue;
    }

    if (char === "," && !inQuote) {
      const trimmed = current.trim();
      if (trimmed !== "") {
        descriptors.push(stripYarnQuotes(trimmed));
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed !== "") {
    descriptors.push(stripYarnQuotes(trimmed));
  }

  return descriptors;
}

function stripYarnQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function matchesYarnDescriptor(
  descriptor: string,
  packageName: string,
  currentRange: string
): boolean {
  if (currentRange === "") {
    return false;
  }
  if (!descriptor.startsWith(`${packageName}@`)) {
    return false;
  }
  const range = descriptor.slice(`${packageName}@`.length);
  if (range === currentRange) {
    return true;
  }
  return range.endsWith(`:${currentRange}`);
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
