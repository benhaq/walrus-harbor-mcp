import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["bin/harbor-mcp.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  external: ["@mysten/sui", "@mysten/seal"], // keep heavy crypto optional
});
