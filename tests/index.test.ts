import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";
import {
  formatNextUpdatesGuidePromptMarkdown,
  type NextUpdatesGuideContext,
} from "../src/cli/prompts/next-updates-guide";
import {
  formatNextUpdatesPromptMarkdown,
  writeNextUpdatesReportJson,
} from "../src/cli/tasks/next-updates";

test("formatNextUpdatesPromptMarkdown renders grouped candidates", () => {
  const markdown = formatNextUpdatesPromptMarkdown({
    generatedAt: "2025-01-01T00:00:00.000Z",
    options: {
      scopeRequested: "all",
      scopeEffective: "all",
      target: "latest",
      dep: "all",
      risk: "all",
    },
    packages: {
      "package.json": {
        dependencies: {
          lodash: {
            current: {
              range: "^4.17.0",
              version: "4.17.21",
            },
            target: {
              range: "^4.18.0",
              version: "4.18.0",
            },
            versionWindow: {
              delta: { major: 0, minor: 0, patch: 0, prerelease: 0 },
            },
            evidence: null,
          },
        },
      },
      "packages/a/package.json": {
        devDependencies: {
          vitest: {
            current: {
              range: "^0.1.0",
              version: "0.1.0",
            },
            target: {
              range: "^1.0.0",
              version: "1.0.0",
            },
            versionWindow: {
              delta: { major: 0, minor: 0, patch: 0, prerelease: 0 },
            },
            evidence: null,
          },
        },
      },
    },
  });

  expect(markdown).toContain("# next-updates (P0)");
  expect(markdown).toContain("## package.json");
  expect(markdown).toContain("## packages/a/package.json");
  expect(markdown).toContain("`lodash`");
  expect(markdown).toContain("`vitest` (dev)");
  expect(markdown).toContain("installed: `4.17.21`");
  expect(markdown).toContain("target: `4.18.0`");
  expect(markdown).toContain("- Risk: all");
});

test("writeNextUpdatesReportJson writes to provided filename", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "next-updates-"));
  const outPath = await writeNextUpdatesReportJson({
    cwd,
    fileName: "next-updates-report.json",
    report: {
      generatedAt: "2025-01-01T00:00:00.000Z",
      options: {
        scopeRequested: "root",
        scopeEffective: "root",
        target: "latest",
        dep: "dependencies",
        risk: "all",
      },
      packages: {},
    },
  });

  expect(outPath).toBe(path.join(cwd, "next-updates-report.json"));
  const contents = await fs.readFile(outPath, "utf8");
  expect(contents).toContain('"scopeRequested": "root"');
});

test("formatNextUpdatesGuidePromptMarkdown includes CLI instructions", () => {
  const guideContext: NextUpdatesGuideContext = {
    repoName: "deepcrawl",
    packageManager: "pnpm",
    workspaces: ["apps/*"],
    repoSizeHint: "large",
    workspaceGroups: [
      {
        key: "apps",
        label: "Apps",
        entries: [
          {
            path: "apps/app",
            label: "Dashboard",
            groupKey: "apps",
            groupLabel: "Apps",
          },
        ],
      },
    ],
  };
  const guide = formatNextUpdatesGuidePromptMarkdown(guideContext);

  expect(guide).toContain("# next-updates agent guide");
  expect(guide).toContain("next-updates reads the repo");
  expect(guide).toContain("--interactive");
  expect(guide).toContain("--scope <all|root|workspaces>");
  expect(guide).toContain("--output <prompt|json>");
  expect(guide).toContain("Repo size: large");
  expect(guide).toContain("Dashboard");
});
