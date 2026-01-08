import type {
  NextUpdatesDep,
  NextUpdatesOutput,
  NextUpdatesPromptResult,
  NextUpdatesRisk,
  NextUpdatesScope,
  NextUpdatesTarget,
} from "../../config/options";
import type { ClackUi } from "../ui/clack";

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

  const risk =
    defaults.risk ??
    (await ui.selectOne<NextUpdatesRisk>("Risk filter", [
      {
        value: "all",
        label: "all (default)",
        hint: "No risk filtering",
      },
      {
        value: "major-only",
        label: "major-only",
        hint: "Major bumps only",
      },
      {
        value: "non-major",
        label: "non-major (minor, patch, none)",
        hint: "Exclude major and prerelease",
      },
      {
        value: "prerelease-only",
        label: "prerelease-only",
        hint: "Target is prerelease",
      },
      {
        value: "unknown-only",
        label: "unknown-only",
        hint: "Missing or invalid versions",
      },
    ]));

  if (risk === null) {
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
    risk,
    output,
  };
}
