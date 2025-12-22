import type { ClackUi } from "../ui/clack-ui";

export type NextUpdatesScope = "all" | "root" | "workspaces";
export type NextUpdatesTarget = "latest" | "minor" | "patch";
export type NextUpdatesDep = "all" | "dependencies" | "devDependencies";
export type NextUpdatesOutput = "prompt" | "json";

export type NextUpdatesPromptResult = {
  scope: NextUpdatesScope;
  target: NextUpdatesTarget;
  dep: NextUpdatesDep;
  output: NextUpdatesOutput;
};

export async function promptNextUpdates(
  ui: ClackUi,
  defaults: Partial<NextUpdatesPromptResult> = {}
): Promise<NextUpdatesPromptResult | null> {
  const scope =
    defaults.scope ??
    (await ui.selectOne<NextUpdatesScope>("Scope", [
      {
        value: "all",
        label: "All deps",
        hint: "Check root + all workspaces",
      },
      {
        value: "root",
        label: "Only root dependencies",
        hint: "Check only root package.json",
      },
      {
        value: "workspaces",
        label: "Only workspaces dependencies",
        hint: "Check all workspaces (exclude root)",
      },
    ]));

  if (scope === null) {
    return null;
  }

  const target =
    defaults.target ??
    (await ui.selectOne<NextUpdatesTarget>("Target", [
      {
        value: "latest",
        label: "latest",
        hint: "Best for AI context (max changes)",
      },
      {
        value: "minor",
        label: "minor",
        hint: "More conservative (no major bumps)",
      },
      {
        value: "patch",
        label: "patch",
        hint: "Most conservative (patch only)",
      },
    ]));

  if (target === null) {
    return null;
  }

  const dep =
    defaults.dep ??
    (await ui.selectOne<NextUpdatesDep>("Dependency types (--dep)", [
      {
        value: "all",
        label: "all",
        hint: "dependencies + devDependencies",
      },
      {
        value: "dependencies",
        label: "dependencies",
        hint: "Runtime deps (production)",
      },
      {
        value: "devDependencies",
        label: "devDependencies",
        hint: "Dev-only deps (build/test/lint)",
      },
    ]));

  if (dep === null) {
    return null;
  }

  const output =
    defaults.output ??
    (await ui.selectOne<NextUpdatesOutput>("Output", [
      {
        value: "prompt",
        label: "Prompt",
        hint: "Print Markdown to stdout (copy/paste to AI)",
      },
      {
        value: "json",
        label: "JSON",
        hint: "Write report file to current directory",
      },
    ]));

  if (output === null) {
    return null;
  }

  return {
    scope,
    target,
    dep,
    output,
  };
}
