const titleCaseSplitRegex = /[\s_-]+/;
const mixedCaseRegex = /[A-Z]/;

export function normalizePath(input: string): string {
  return input.replaceAll("\\", "/");
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toTitleCase(input: string): string {
  return input
    .split(titleCaseSplitRegex)
    .filter((part) => part.length > 0)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["api", "ui", "db", "sdk", "v0", "v1", "v2", "id"].includes(lower)) {
        return lower.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function formatLabelCase(label: string): string {
  const hasMixedCase = mixedCaseRegex.test(label.slice(1));
  return hasMixedCase ? label : toTitleCase(label);
}
