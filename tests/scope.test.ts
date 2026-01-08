import { expect, test } from "vitest";

import { resolveScopeEffective } from "../src/cli/tasks/next-updates/scope";

test("resolveScopeEffective falls back to root when workspaces missing", () => {
  expect(resolveScopeEffective("all", false)).toBe("root");
  expect(resolveScopeEffective("workspaces", false)).toBe("root");
});

test("resolveScopeEffective keeps requested scope when available", () => {
  expect(resolveScopeEffective("workspaces", true)).toBe("workspaces");
  expect(resolveScopeEffective("root", true)).toBe("root");
});
