import type { NextUpdatesScope } from "../../config/options";

export function resolveScopeEffective(
  scopeRequested: NextUpdatesScope,
  workspacesAvailable: boolean
): NextUpdatesScope {
  if (workspacesAvailable || scopeRequested === "root") {
    return scopeRequested;
  }
  return "root";
}
