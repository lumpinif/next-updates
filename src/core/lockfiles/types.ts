export type InstalledVersionLookup = (
  packageFile: string,
  packageName: string,
  currentRange: string
) => string | null;
