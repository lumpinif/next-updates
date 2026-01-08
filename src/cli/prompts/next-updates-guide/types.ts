export type WorkspaceEntry = {
  path: string;
  label: string;
  groupKey: string;
  groupLabel: string;
};

export type WorkspaceGroup = {
  key: string;
  label: string;
  entries: WorkspaceEntry[];
};

export type NextUpdatesGuideContext = {
  repoName?: string;
  packageManager?: string;
  workspaces?: string[];
  workspaceEntries?: WorkspaceEntry[];
  workspaceGroups?: WorkspaceGroup[];
  repoSizeHint?: "small" | "large";
};
