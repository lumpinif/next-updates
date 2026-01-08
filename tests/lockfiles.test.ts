import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { createNpmInstalledVersionLookup } from "../src/core/lockfiles/npm";
import { createPnpmInstalledVersionLookup } from "../src/core/lockfiles/pnpm";

test("npm lockfile lookup reads installed version", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "next-updates-"));
  const lockfilePath = path.join(cwd, "package-lock.json");
  const lockfile = {
    packages: {
      "node_modules/lodash": { version: "4.17.21" },
    },
    dependencies: {
      lodash: { version: "4.17.21" },
    },
  };
  await fs.writeFile(lockfilePath, JSON.stringify(lockfile, null, 2));

  const lookup = await createNpmInstalledVersionLookup(lockfilePath);
  const version = lookup("package.json", "lodash", "^4.17.0");

  expect(version).toBe("4.17.21");
});

test("pnpm lockfile lookup resolves importers and normalizes versions", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "next-updates-"));
  const lockfilePath = path.join(cwd, "pnpm-lock.yaml");
  const lockfile = [
    "importers:",
    "  .:",
    "    dependencies:",
    "      lodash: 4.17.21(esbuild@0.18.0)",
    "  packages/app:",
    "    devDependencies:",
    "      vitest: 1.0.0",
  ].join("\n");
  await fs.writeFile(lockfilePath, lockfile);

  const lookup = await createPnpmInstalledVersionLookup(lockfilePath);
  const rootVersion = lookup("package.json", "lodash", "^4.17.0");
  const workspaceVersion = lookup(
    "packages/app/package.json",
    "vitest",
    "^1.0.0"
  );

  expect(rootVersion).toBe("4.17.21");
  expect(workspaceVersion).toBe("1.0.0");
});
