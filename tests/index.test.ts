import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  formatReviewDepsPromptMarkdown,
  writeReviewDepsReportJson,
} from "../src/cli/tasks/review-deps";

test("formatReviewDepsPromptMarkdown renders grouped candidates", () => {
  const markdown = formatReviewDepsPromptMarkdown({
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
        currentSpec: "^4.17.0",
        upgradedSpec: "^4.18.0",
      },
      {
        packageFile: "packages/a/package.json",
        dependencyType: "devDependencies",
        packageName: "vitest",
        currentSpec: "^0.1.0",
        upgradedSpec: "^1.0.0",
      },
    ],
  });

  expect(markdown).toContain("# review-deps (P0)");
  expect(markdown).toContain("## package.json");
  expect(markdown).toContain("## packages/a/package.json");
  expect(markdown).toContain("`lodash`");
  expect(markdown).toContain("`vitest` (dev)");
});

test("writeReviewDepsReportJson writes to provided filename", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "review-deps-"));
  const outPath = await writeReviewDepsReportJson({
    cwd,
    fileName: "review-deps-report.json",
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

  expect(outPath).toBe(path.join(cwd, "review-deps-report.json"));
  const contents = await fs.readFile(outPath, "utf8");
  expect(contents).toContain('"scopeRequested": "root"');
});
