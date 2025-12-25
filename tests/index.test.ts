import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

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
    },
    candidates: [
      {
        packageFile: "package.json",
        dependencyType: "dependencies",
        packageName: "lodash",
        currentRange: "^4.17.0",
        suggestedRange: "^4.18.0",
        installedVersion: "4.17.21",
        targetVersion: "4.18.0",
      },
      {
        packageFile: "packages/a/package.json",
        dependencyType: "devDependencies",
        packageName: "vitest",
        currentRange: "^0.1.0",
        suggestedRange: "^1.0.0",
        installedVersion: "0.1.0",
        targetVersion: "1.0.0",
      },
    ],
  });

  expect(markdown).toContain("# next-updates (P0)");
  expect(markdown).toContain("## package.json");
  expect(markdown).toContain("## packages/a/package.json");
  expect(markdown).toContain("`lodash`");
  expect(markdown).toContain("`vitest` (dev)");
  expect(markdown).toContain("installed: `4.17.21`");
  expect(markdown).toContain("target: `4.18.0`");
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
      },
      candidates: [],
    },
  });

  expect(outPath).toBe(path.join(cwd, "next-updates-report.json"));
  const contents = await fs.readFile(outPath, "utf8");
  expect(contents).toContain('"scopeRequested": "root"');
});
