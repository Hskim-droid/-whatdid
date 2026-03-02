import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/mcp.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["better-sqlite3"],
});
