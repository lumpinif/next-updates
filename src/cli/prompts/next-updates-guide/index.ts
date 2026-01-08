import { collectNextUpdatesGuideContext as collectContext } from "./context";
import { formatNextUpdatesGuidePromptMarkdown as formatGuide } from "./template";
import type { NextUpdatesGuideContext as NextUpdatesGuideContextType } from "./types";

export type NextUpdatesGuideContext = NextUpdatesGuideContextType;

export function collectNextUpdatesGuideContext(
  cwd: string
): Promise<NextUpdatesGuideContext> {
  return collectContext(cwd);
}

export function formatNextUpdatesGuidePromptMarkdown(
  context: NextUpdatesGuideContext
): string {
  return formatGuide(context);
}
