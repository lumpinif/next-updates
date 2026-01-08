import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";
import {
  detectWorkspacePatterns,
  hasWorkspaceConfig,
} from "../src/infra/fs/workspaces";

async function writePackageJson(
  dir: string,
  contents: Record<string, unknown>
): Promise<void> {
  const filePath = path.join(dir, "package.json");
  await fs.writeFile(filePath, JSON.stringify(contents, null, 2));
}

async function writePnpmWorkspace(
  dir: string,
  contents: string
): Promise<void> {
  const filePath = path.join(dir, "pnpm-workspace.yaml");
  await fs.writeFile(filePath, contents);
}

test("detectWorkspacePatterns merges and sorts patterns", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "next-updates-"));
  await writePackageJson(cwd, {
    name: "fixture",
    workspaces: ["apps/*", "packages/*"],
  });
  await writePnpmWorkspace(
    cwd,
    ["packages:", "  - packages/*", "  - tools/*"].join("\n")
  );

  const patterns = await detectWorkspacePatterns(cwd);

  expect(patterns).toEqual(["apps/*", "packages/*", "tools/*"]);
});

test("hasWorkspaceConfig returns false when no workspace config", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "next-updates-"));
  await writePackageJson(cwd, { name: "fixture" });

  const hasWorkspaces = await hasWorkspaceConfig(cwd);

  expect(hasWorkspaces).toBe(false);
});
