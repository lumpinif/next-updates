import { compare, gte, lte, parse, valid } from "semver";

export type NextUpdatesVersionWindow = {
  delta: {
    major: number;
    minor: number;
    patch: number;
    prerelease: number;
  };
};

export type NextUpdatesEvidence = {
  links: {
    compare?: string;
    npmDiffLink?: string;
  };
};

export type CandidateEvidenceInput = {
  packageName: string;
  installedVersion: string | null;
  targetVersion: string | null;
};

export type CandidateEvidenceResult = {
  versionWindow: NextUpdatesVersionWindow;
  evidence: NextUpdatesEvidence | null;
};

type NpmRegistryRepository =
  | string
  | {
      type?: string;
      url?: string;
    };

type NpmRegistryPackage = {
  versions?: Record<string, unknown>;
  repository?: NpmRegistryRepository;
};

type CompareTagPair = {
  from: string;
  to: string;
};

const npmRegistryBaseUrl = "https://registry.npmjs.org";
const gitPlusRegex = /^git\+/;
const gitProtocolRegex = /^git:\/\//;
const gitSshRegex = /^ssh:\/\/git@github.com\//;
const gitAtRegex = /^git@github.com:/;
const gitHashRegex = /#.*$/;
const gitHubRepoRegex = /github\.com\/([^/]+\/[^/#]+)(?:[/.#].*)?/;
const gitSuffixRegex = /\.git$/;

export function collectCandidateEvidence(
  inputs: readonly CandidateEvidenceInput[]
): Promise<CandidateEvidenceResult[]> {
  const registryCache = new Map<string, Promise<NpmRegistryPackage | null>>();
  const compareUrlCache = new Map<string, Promise<boolean>>();

  return Promise.all(
    inputs.map((input) =>
      buildCandidateEvidence(input, registryCache, compareUrlCache)
    )
  );
}

async function buildCandidateEvidence(
  input: CandidateEvidenceInput,
  registryCache: Map<string, Promise<NpmRegistryPackage | null>>,
  compareUrlCache: Map<string, Promise<boolean>>
): Promise<CandidateEvidenceResult> {
  const npmDiffLink = buildNpmDiffLink(
    input.packageName,
    input.installedVersion,
    input.targetVersion
  );

  if (!(input.installedVersion && input.targetVersion)) {
    return {
      versionWindow: createEmptyVersionWindow(),
      evidence: buildEvidenceLinks(null, npmDiffLink),
    };
  }

  const registry = await getRegistryPackage(input.packageName, registryCache);
  if (!registry) {
    return {
      versionWindow: createEmptyVersionWindow(),
      evidence: buildEvidenceLinks(null, npmDiffLink),
    };
  }

  const versionWindow = buildVersionWindow(
    registry,
    input.installedVersion,
    input.targetVersion
  );

  const compareUrl = await buildCompareEvidence({
    registry,
    packageName: input.packageName,
    installedVersion: input.installedVersion,
    targetVersion: input.targetVersion,
    compareUrlCache,
  });

  return {
    versionWindow,
    evidence: buildEvidenceLinks(compareUrl, npmDiffLink),
  };
}

function buildVersionWindow(
  registry: NpmRegistryPackage,
  installedVersion: string,
  targetVersion: string
): NextUpdatesVersionWindow {
  const from = valid(installedVersion);
  const to = valid(targetVersion);
  if (!(from && to) || compare(from, to) > 0) {
    return createEmptyVersionWindow();
  }

  const versionKeys = getRegistryVersionKeys(registry);
  const window: string[] = [];
  for (const version of versionKeys) {
    if (gte(version, from) && lte(version, to)) {
      window.push(version);
    }
  }

  return {
    delta: countVersionDelta(window, from),
  };
}

function createEmptyVersionWindow(): NextUpdatesVersionWindow {
  return {
    delta: {
      major: 0,
      minor: 0,
      patch: 0,
      prerelease: 0,
    },
  };
}

function countVersionDelta(
  versions: readonly string[],
  base: string
): NextUpdatesVersionWindow["delta"] {
  const baseMajor = semverMajor(base);
  const baseMinor = semverMinor(base);
  const basePatch = semverPatch(base);

  const delta = {
    major: 0,
    minor: 0,
    patch: 0,
    prerelease: 0,
  };

  for (const version of versions) {
    if (version === base) {
      continue;
    }

    if (semverPrerelease(version)) {
      delta.prerelease += 1;
      continue;
    }

    const major = semverMajor(version);
    const minor = semverMinor(version);
    const patch = semverPatch(version);

    if (major > baseMajor) {
      delta.major += 1;
      continue;
    }

    if (major === baseMajor && minor > baseMinor) {
      delta.minor += 1;
      continue;
    }

    if (major === baseMajor && minor === baseMinor && patch > basePatch) {
      delta.patch += 1;
    }
  }

  return delta;
}

function semverMajor(value: string): number {
  return semverParse(value)?.major ?? 0;
}

function semverMinor(value: string): number {
  return semverParse(value)?.minor ?? 0;
}

function semverPatch(value: string): number {
  return semverParse(value)?.patch ?? 0;
}

function semverPrerelease(value: string): boolean {
  return Boolean(parse(value)?.prerelease.length);
}

function semverParse(value: string): {
  major: number;
  minor: number;
  patch: number;
} | null {
  const parsed = parse(value);
  if (!parsed) {
    return null;
  }
  return { major: parsed.major, minor: parsed.minor, patch: parsed.patch };
}

function buildEvidenceLinks(
  compareUrl: string | null,
  npmDiffLink: string | null
): NextUpdatesEvidence | null {
  if (!(compareUrl || npmDiffLink)) {
    return null;
  }
  const links: NextUpdatesEvidence["links"] = {};
  if (compareUrl) {
    links.compare = compareUrl;
  }
  if (npmDiffLink) {
    links.npmDiffLink = npmDiffLink;
  }
  return { links };
}

async function buildCompareEvidence(options: {
  registry: NpmRegistryPackage;
  packageName: string;
  installedVersion: string;
  targetVersion: string;
  compareUrlCache: Map<string, Promise<boolean>>;
}): Promise<string | null> {
  const repositoryUrl = normalizeRepositoryUrl(options.registry.repository);
  if (!repositoryUrl) {
    return null;
  }

  const fromVersion = normalizeTagVersion(options.installedVersion);
  const toVersion = normalizeTagVersion(options.targetVersion);
  if (!(fromVersion && toVersion)) {
    return null;
  }

  const tagPairs = buildCompareTagPairs(
    options.packageName,
    fromVersion,
    toVersion
  );
  for (const pair of tagPairs) {
    const compareUrl = buildCompareUrl(repositoryUrl, pair);
    const reachable = await isCompareUrlReachable(
      compareUrl,
      options.compareUrlCache
    );
    if (reachable) {
      return compareUrl;
    }
  }

  return null;
}

function buildNpmDiffLink(
  packageName: string,
  installedVersion: string | null,
  targetVersion: string | null
): string | null {
  if (!(installedVersion && targetVersion)) {
    return null;
  }
  return `npm diff --diff ${packageName}@${installedVersion} --diff ${packageName}@${targetVersion}`;
}

function getRegistryVersionKeys(registry: NpmRegistryPackage): string[] {
  if (!isRecord(registry.versions)) {
    return [];
  }
  const versions = Object.keys(registry.versions).filter((version) =>
    Boolean(valid(version))
  );
  versions.sort(compare);
  return versions;
}

function normalizeTagVersion(version: string): string | null {
  const normalized = version.trim();
  if (normalized === "") {
    return null;
  }
  if (normalized.startsWith("v")) {
    const withoutPrefix = normalized.slice(1);
    if (valid(withoutPrefix)) {
      return withoutPrefix;
    }
  }
  return normalized;
}

function buildCompareTagPairs(
  packageName: string,
  fromVersion: string,
  toVersion: string
): CompareTagPair[] {
  const unscoped = getUnscopedPackageName(packageName);
  const pairs: CompareTagPair[] = [
    { from: `v${fromVersion}`, to: `v${toVersion}` },
    { from: fromVersion, to: toVersion },
    {
      from: `${packageName}@${fromVersion}`,
      to: `${packageName}@${toVersion}`,
    },
  ];

  if (unscoped && unscoped !== packageName) {
    pairs.push({
      from: `${unscoped}@${fromVersion}`,
      to: `${unscoped}@${toVersion}`,
    });
  }

  return pairs;
}

function getUnscopedPackageName(packageName: string): string {
  if (!packageName.startsWith("@")) {
    return packageName;
  }
  const slashIndex = packageName.indexOf("/");
  if (slashIndex === -1) {
    return packageName;
  }
  return packageName.slice(slashIndex + 1);
}

function buildCompareUrl(repoUrl: string, pair: CompareTagPair): string {
  const fromTag = encodeGitTag(pair.from);
  const toTag = encodeGitTag(pair.to);
  return `${repoUrl}/compare/${fromTag}...${toTag}`;
}

function encodeGitTag(tag: string): string {
  return encodeURIComponent(tag);
}

function isCompareUrlReachable(
  url: string,
  cache: Map<string, Promise<boolean>>
): Promise<boolean> {
  const cached = cache.get(url);
  if (cached) {
    return cached;
  }

  const checkPromise = checkCompareUrl(url);
  cache.set(url, checkPromise);
  return checkPromise;
}

async function checkCompareUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.status === 200;
  } catch {
    return false;
  }
}

function getRegistryPackage(
  packageName: string,
  cache: Map<string, Promise<NpmRegistryPackage | null>>
): Promise<NpmRegistryPackage | null> {
  const cached = cache.get(packageName);
  if (cached) {
    return cached;
  }

  const fetchPromise = fetchRegistryPackage(packageName);
  cache.set(packageName, fetchPromise);
  return fetchPromise;
}

async function fetchRegistryPackage(
  packageName: string
): Promise<NpmRegistryPackage | null> {
  try {
    const encoded = encodeURIComponent(packageName);
    const response = await fetch(`${npmRegistryBaseUrl}/${encoded}`, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    if (!isRecord(data)) {
      return null;
    }
    return data as NpmRegistryPackage;
  } catch {
    return null;
  }
}

function normalizeRepositoryUrl(
  repository: NpmRegistryRepository | undefined
): string | null {
  let raw: string | null = null;
  if (typeof repository === "string") {
    raw = repository;
  } else if (repository && typeof repository.url === "string") {
    raw = repository.url;
  }
  if (!raw) {
    return null;
  }

  let cleaned = raw.trim();
  if (cleaned.startsWith("github:")) {
    cleaned = `https://github.com/${cleaned.slice("github:".length)}`;
  }
  cleaned = cleaned.replace(gitPlusRegex, "");
  cleaned = cleaned.replace(gitProtocolRegex, "https://");
  cleaned = cleaned.replace(gitSshRegex, "https://github.com/");
  cleaned = cleaned.replace(gitAtRegex, "https://github.com/");
  cleaned = cleaned.replace(gitHashRegex, "");

  const match = gitHubRepoRegex.exec(cleaned);
  if (!match) {
    return null;
  }

  const repoPath = match[1].replace(gitSuffixRegex, "");
  return `https://github.com/${repoPath}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
