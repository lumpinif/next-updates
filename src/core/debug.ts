import fs from "node:fs/promises";
import path from "node:path";

export async function writeDebugDump(
  dir: string,
  fileName: string,
  data: unknown
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, fileName);
  await fs.writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`);
}
