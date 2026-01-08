export function normalizeInstalledVersion(value: string): string {
  const parenIndex = value.indexOf("(");
  if (parenIndex === -1) {
    return value;
  }
  return value.slice(0, parenIndex).trim();
}
