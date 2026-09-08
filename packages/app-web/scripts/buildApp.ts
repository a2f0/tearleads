import { fileURLToPath } from "node:url";
import { loroWasmPlugin } from "@tearleads/loro/bun-plugin";

const appDir = new URL("../", import.meta.url);

const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("src/index.html", appDir))],
  outdir: fileURLToPath(new URL("dist/", appDir)),
  sourcemap: "linked",
  target: "browser",
  minify: true,
  env: "BUN_PUBLIC_*",
  publicPath: "/",
  plugins: [loroWasmPlugin],
});

if (!result.success) {
  throw new AggregateError(result.logs, "Failed to build app-web.");
}
