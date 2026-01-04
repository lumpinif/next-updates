import fs from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";

type PackageJson = {
  workspaces?: unknown;
  packageManager?: string;
};

type WorkspaceConfig = {
  packages?: unknown;
};

export type NextUpdatesGuideContext = {
  packageManager?: string;
  workspaces?: string[];
  repoSizeHint?: "small" | "large";
};

const lockfileMap = [
  { name: "pnpm", file: "pnpm-lock.yaml" },
  { name: "npm", file: "package-lock.json" },
  { name: "yarn", file: "yarn.lock" },
  { name: "bun", file: "bun.lock" },
  { name: "bun", file: "bun.lockb" },
] as const;

function parseWorkspacesValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (value && typeof value === "object") {
    const packages = (value as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages.filter(
        (entry): entry is string => typeof entry === "string"
      );
    }
  }
  return [];
}

async function readPackageJson(cwd: string): Promise<PackageJson | null> {
  try {
    const raw = await fs.readFile(path.resolve(cwd, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as PackageJson;
  } catch {
    return null;
  }
}

async function readPnpmWorkspace(cwd: string): Promise<WorkspaceConfig | null> {
  try {
    const raw = await fs.readFile(
      path.resolve(cwd, "pnpm-workspace.yaml"),
      "utf8"
    );
    const parsed = parseYaml(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as WorkspaceConfig;
  } catch {
    return null;
  }
}

async function detectPackageManager(cwd: string): Promise<string | undefined> {
  const pkg = await readPackageJson(cwd);
  if (pkg?.packageManager) {
    const raw = pkg.packageManager;
    if (raw.startsWith("pnpm")) {
      return "pnpm";
    }
    if (raw.startsWith("npm")) {
      return "npm";
    }
    if (raw.startsWith("yarn")) {
      return "yarn";
    }
    if (raw.startsWith("bun")) {
      return "bun";
    }
  }

  for (const candidate of lockfileMap) {
    try {
      await fs.access(path.resolve(cwd, candidate.file));
      return candidate.name;
    } catch {
      // Ignore missing lockfiles.
    }
  }

  return;
}

async function detectWorkspaces(cwd: string): Promise<string[]> {
  const workspaceMatches: string[] = [];
  const pkg = await readPackageJson(cwd);
  if (pkg?.workspaces) {
    workspaceMatches.push(...parseWorkspacesValue(pkg.workspaces));
  }

  const pnpmWorkspace = await readPnpmWorkspace(cwd);
  if (pnpmWorkspace?.packages) {
    workspaceMatches.push(...parseWorkspacesValue(pnpmWorkspace.packages));
  }

  return Array.from(new Set(workspaceMatches)).sort();
}

function resolveRepoSizeHint(workspaces: string[]): "small" | "large" {
  if (workspaces.length >= 4) {
    return "large";
  }
  if (workspaces.some((entry) => entry.includes("*"))) {
    return "large";
  }
  return "small";
}

export async function collectNextUpdatesGuideContext(
  cwd: string
): Promise<NextUpdatesGuideContext> {
  const packageManager = await detectPackageManager(cwd);
  const workspaces = await detectWorkspaces(cwd);
  const repoSizeHint =
    workspaces.length > 0 ? resolveRepoSizeHint(workspaces) : undefined;

  return {
    packageManager,
    workspaces: workspaces.length > 0 ? workspaces : undefined,
    repoSizeHint,
  };
}

export function formatNextUpdatesGuidePromptMarkdown(
  context: NextUpdatesGuideContext
): string {
  const lines: string[] = [
    "# next-updates agent guide",
    "",
    "## How to run next-updates",
    "",
    "If you are a human:",
    "- Copy this prompt into your coding agent (Cursor/Claude/ChatGPT).",
    "- Or run the interactive UI:",
    "",
    "```bash",
    "npx next-updates@latest --interactive",
    "```",
    "",
    "If you are an agent:",
    "1. Start with a 1-2 sentence intro in plain words (what next-updates does and what you will do).",
    "2. Ask the user for options with plain meanings and a recommendation.",
    "3. Keep the questions tailored to the repo (use detected workspaces).",
    "4. Use output=prompt by default. Only ask for JSON if the user wants it.",
    "5. Run next-updates with flags:",
    "",
    "```bash",
    "npx next-updates@latest --scope <all|root|workspaces> --target <latest|minor|patch> --dep <all|dependencies|devDependencies> --risk <all|major-only|non-major|prerelease-only|unknown-only> --output <prompt|json>",
    "```",
    "",
    "6. If output is json, read `next-updates-report.json` from the project root.",
    "7. Use evidence links (changelog, releases, compare) to collect facts.",
    "8. If evidence links are missing, find them via registry metadata or the repo; only ask the user if blocked.",
    "9. Summarize what to update and why in simple words. Do not change code unless asked.",
  ];

  const detectedLines = formatDetectedContext(context);
  if (detectedLines.length > 0) {
    lines.push("", "Detected context:", ...detectedLines);
  }

  const guidanceLines = formatGuidance(context);
  lines.push("", "Ask options in plain words:");
  lines.push(...guidanceLines);

  lines.push(
    "",
    "Output rules:",
    "- Keep it short and easy to read. Use simple words.",
    "- Two sections: Worth upgrading now, Can wait.",
    "- For each package, write two short lines:",
    "  - Change: what is new or fixed.",
    "  - Impact: why this matters for the repo.",
    "- Write like a helpful teammate, not a template. Avoid filler.",
    "- Group related packages with the same change to avoid repetition.",
    "- Do not list evidence links unless the user asks for sources.",
    "- Use evidence to form your summary. If you cannot find evidence, say so.",
    "- Focus on user impact: new features, critical fixes, and new capabilities.",
    "- Mention breaking changes, deprecations, and security first.",
    "- Use repo signals to mention frameworks/ecosystems when helpful.",
    "- Do not assume a stack if it is not detected.",
    "- Do not show upgrade commands unless the user asks."
  );

  return `${lines.join("\n")}\n`;
}

function formatDetectedContext(context: NextUpdatesGuideContext): string[] {
  const lines: string[] = [];
  if (context.packageManager) {
    lines.push(`- Package manager: ${context.packageManager}`);
  }
  if (context.workspaces && context.workspaces.length > 0) {
    lines.push(`- Workspaces: ${context.workspaces.join(", ")}`);
  }
  if (context.repoSizeHint) {
    lines.push(`- Repo size hint: ${context.repoSizeHint}`);
  }
  return lines;
}

function formatGuidance(context: NextUpdatesGuideContext): string[] {
  const workspaces = context.workspaces ?? [];
  const lines: string[] = [
    "- scope: root (only this repo root), workspaces (only workspace package.json files), all (root + workspaces).",
    "- target: latest (more change), minor (no majors), patch (smallest changes).",
    "- dep: dependencies (runtime), devDependencies (dev-only), all (both).",
    "- risk: major-only (big changes), all (everything), non-major, prerelease-only, unknown-only.",
  ];

  if (context.repoSizeHint === "large") {
    lines.unshift(
      "- This repo looks large. Recommend a smaller first run: root or workspaces."
    );
    if (workspaces.length > 0) {
      lines.unshift(
        "- Prioritize app-facing runtime workspaces first (main apps/services)."
      );
    }
  }

  if (context.repoSizeHint === "small") {
    lines.unshift(
      "- This repo looks small. Recommend scope=all for the first run."
    );
  }

  return lines;
}
