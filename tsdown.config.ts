import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    bin: "src/bin.ts",
  },
  // We manage package.json "exports" manually; also avoid generating exports for bin entries.
  exports: false,
});
