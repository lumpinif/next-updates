import type { NextUpdatesGuideContext, WorkspaceGroup } from "./types";

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
    "5. Before summarizing, scan the repo to confirm usage (imports, scripts, configs).",
    "6. Run next-updates with flags:",
    "",
    "```bash",
    "npx next-updates@latest --scope <all|root|workspaces> --target <latest|minor|patch> --dep <all|dependencies|devDependencies> --risk <all|major-only|non-major|prerelease-only|unknown-only> --output <prompt|json>",
    "```",
    "",
    "7. If output is json, read `next-updates-report.json` from the project root.",
    "8. Use evidence links (changelog, releases, compare) to collect facts.",
    "9. If evidence links are missing, find them via registry metadata or the repo; only ask the user if blocked.",
    "10. Summarize what to update and why in simple words. Do not change code unless asked.",
    "11. If the user asks to dig into one package, switch to a short deep-dive response (see Output rules).",
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
    "  - Change: include one technical term plus one plain sentence.",
    "  - Impact: why this matters for the repo, in plain words.",
    "- Write like a helpful teammate, not a template. Avoid filler.",
    "- Group related packages with the same change to avoid repetition.",
    "- Do not list evidence links unless the user asks for sources.",
    "- Do not include file paths or tool logs. Mention usage by area (API, UI, worker).",
    "- Use evidence to form your summary. If you cannot find evidence, say so.",
    "- Focus on user impact: new features, critical fixes, and new capabilities.",
    "- Mention breaking changes, deprecations, and security first.",
    "- Use repo signals to mention frameworks/ecosystems when helpful.",
    "- Do not assume a stack if it is not detected.",
    "- Do not show upgrade commands unless the user asks.",
    "- Only claim impact when usage is confirmed in the repo; otherwise say it is not detected.",
    "- Deep dive (single package):",
    "  - One-line recommendation (upgrade now / wait / try in a small area).",
    "  - Key changes: 2-3 short bullets.",
    "  - Risks/unknowns: 1-2 short bullets.",
    "  - Next step: 1 optional action (sample diff, run a check).",
    "- Output must be in English."
  );

  return `${lines.join("\n")}\n`;
}

function formatDetectedContext(context: NextUpdatesGuideContext): string[] {
  const lines: string[] = [];
  if (context.repoName) {
    lines.push(`- Repo: ${context.repoName}`);
  }
  if (context.packageManager) {
    lines.push(`- Package manager: ${context.packageManager}`);
  }
  if (context.workspaces && context.workspaces.length > 0) {
    const preview = formatWorkspacePreview(context.workspaces);
    lines.push(`- Workspaces: ${preview}`);
  }
  if (context.repoSizeHint) {
    lines.push(`- Repo size: ${context.repoSizeHint}`);
  }
  return lines;
}

function formatGuidance(context: NextUpdatesGuideContext): string[] {
  const workspaceGroups = context.workspaceGroups ?? [];
  const lines: string[] = [];
  const recommendation = buildRecommendation(context);
  const repoLabel = context.repoName ?? "this repo";

  lines.push("- Use the question below as-is:");
  lines.push("```text");
  lines.push(
    ...formatSuggestedQuestion({
      repoLabel,
      workspaceGroups,
      recommendation,
      repoSizeHint: context.repoSizeHint,
    })
  );
  lines.push("```");
  lines.push("");
  lines.push(
    "- If the user wants to tweak later, map their plain answer to flags."
  );

  return lines;
}

function formatWorkspacePreview(workspaces: string[]): string {
  const maxPreview = 4;
  const preview = workspaces.slice(0, maxPreview);
  const extraCount = workspaces.length - preview.length;
  if (extraCount <= 0) {
    return preview.join(", ");
  }
  return `${preview.join(", ")}, +${extraCount} more`;
}

function buildRecommendation(context: NextUpdatesGuideContext): {
  scope: "root" | "workspaces" | "all";
  target: "latest" | "minor" | "patch";
  dep: "dependencies" | "devDependencies" | "all";
  risk: "major-only" | "all" | "non-major" | "prerelease-only" | "unknown-only";
} {
  const hasWorkspaces =
    context.workspaces !== undefined && context.workspaces.length > 0;

  if (context.repoSizeHint === "large" && hasWorkspaces) {
    return {
      scope: "workspaces",
      target: "latest",
      dep: "dependencies",
      risk: "major-only",
    };
  }

  if (context.repoSizeHint === "small" && hasWorkspaces) {
    return {
      scope: "all",
      target: "latest",
      dep: "dependencies",
      risk: "all",
    };
  }

  return {
    scope: "root",
    target: "latest",
    dep: "dependencies",
    risk: "all",
  };
}

function formatSuggestedQuestion(options: {
  repoLabel: string;
  workspaceGroups: WorkspaceGroup[];
  recommendation: {
    scope: "root" | "workspaces" | "all";
    target: "latest" | "minor" | "patch";
    dep: "dependencies" | "devDependencies" | "all";
    risk:
      | "major-only"
      | "all"
      | "non-major"
      | "prerelease-only"
      | "unknown-only";
  };
  repoSizeHint?: "small" | "large";
}): string[] {
  const { repoLabel, workspaceGroups, recommendation, repoSizeHint } = options;
  const lines: string[] = [];
  lines.push(
    "next-updates reads the repo, then summarizes upgrades that matter."
  );
  lines.push(
    `I'll scan ${repoLabel} and return a short guide: what to do now vs later.`
  );

  if (repoSizeHint === "large") {
    lines.push("Large repo, start small.");
  }
  if (repoSizeHint === "small") {
    lines.push("Small repo, start broad.");
  }

  lines.push(
    `Recommended: ${formatRecommendationSentence(
      recommendation,
      repoLabel,
      workspaceGroups
    )}.`
  );
  lines.push('Reply with "use recommended", or answer in plain words:');
  lines.push(...formatWhereToStartQuestionLines(repoLabel, workspaceGroups));
  lines.push(...formatChangeSizeQuestionLines());
  lines.push(...formatDepsQuestionLines());

  return lines;
}

function formatRecommendationSentence(
  recommendation: {
    scope: "root" | "workspaces" | "all";
    target: "latest" | "minor" | "patch";
    dep: "dependencies" | "devDependencies" | "all";
    risk:
      | "major-only"
      | "all"
      | "non-major"
      | "prerelease-only"
      | "unknown-only";
  },
  repoLabel: string,
  workspaceGroups: WorkspaceGroup[]
): string {
  const scopeText = buildScopeSentence(
    recommendation.scope,
    repoLabel,
    workspaceGroups
  );
  const changeText = buildChangeSentence(recommendation);
  const depText = buildDepSentence(recommendation.dep);
  return `${scopeText}, ${changeText}, ${depText}`;
}

function buildScopeSentence(
  scope: "root" | "workspaces" | "all",
  repoLabel: string,
  workspaceGroups: WorkspaceGroup[]
): string {
  if (scope === "root") {
    return `root tools (${repoLabel}/package.json)`;
  }
  if (scope === "all") {
    return "everything (root + all workspaces)";
  }
  const examples = formatScopeExamples(workspaceGroups);
  return `workspaces (all sub-projects${examples})`;
}

function buildChangeSentence(recommendation: {
  target: "latest" | "minor" | "patch";
  risk: "major-only" | "all" | "non-major" | "prerelease-only" | "unknown-only";
}): string {
  if (recommendation.risk === "major-only") {
    return "big changes (major)";
  }
  if (recommendation.target === "minor") {
    return "balanced (major + minor)";
  }
  if (recommendation.target === "patch") {
    return "safer (minor + patch)";
  }
  return "all changes";
}

function buildDepSentence(
  dep: "dependencies" | "devDependencies" | "all"
): string {
  if (dep === "dependencies") {
    return "runtime deps (dependencies)";
  }
  if (dep === "devDependencies") {
    return "dev tools (devDependencies)";
  }
  return "runtime + dev tools (dependencies + devDependencies)";
}

function formatWhereToStartQuestionLines(
  repoLabel: string,
  groups: WorkspaceGroup[]
): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("1) Where should I start?");
  lines.push(`- Root tools (${repoLabel}/package.json)`);
  const examples = formatScopeExamples(groups);
  lines.push(`- Workspaces (all sub-projects${examples})`);
  lines.push("- Everything (root + all workspaces)");
  return lines;
}

function formatChangeSizeQuestionLines(): string[] {
  return [
    "",
    "2) How aggressive? (version jump size)",
    "- Big changes only (major)",
    "- Balanced (major + minor)",
    "- Safer (minor + patch)",
  ];
}

function formatDepsQuestionLines(): string[] {
  return [
    "",
    "3) Which deps?",
    "- Runtime only (dependencies)",
    "- Runtime + dev tools (dependencies + devDependencies)",
  ];
}

function pickFocusGroups(groups: WorkspaceGroup[]): string[] {
  const preferred = ["Workers", "Apps", "Services", "API", "Web", "Backend"];
  const ranked = groups
    .map((group) => ({
      group,
      score: preferred.some((label) =>
        getGroupDisplayLabel(group).toLowerCase().includes(label.toLowerCase())
      )
        ? 1
        : 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.group.entries.length - a.group.entries.length;
    })
    .map((item) => getGroupDisplayLabel(item.group));

  return ranked.slice(0, 2);
}

function formatScopeExamples(groups: WorkspaceGroup[]): string {
  const examples = pickFocusGroups(groups);
  if (examples.length === 0) {
    return "";
  }
  return `, like ${examples.join(", ")}`;
}

function getGroupDisplayLabel(group: WorkspaceGroup): string {
  if (group.entries.length === 1) {
    const entry = group.entries[0];
    if (entry) {
      return entry.label;
    }
  }
  return group.label;
}
