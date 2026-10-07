import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteLicensesUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";
import { moduleSpecifiers } from "./packageOutput";

const sqliteInstanceDir = fileURLToPath(
  new URL("../../sqlite-instance/", import.meta.url),
);

// The worker bundles SQLite's module and copies its WebAssembly, which
// @tearleads/sqlite-instance downloads when it builds and skips once present,
// so every caller works from a clean checkout.
function buildSqliteInstance() {
  const result = spawnSync(
    process.execPath,
    ["run", "--cwd", sqliteInstanceDir, "build"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(
      `building @tearleads/sqlite-instance exited with ${result.status}`,
    );
  }
}

// Writes the files a host serves for createSQLiteRuntime: the worker as one
// self-contained module, the SQLite WebAssembly it loads from beside itself
// (resolved against the module's own URL), and the licenses both carry. Every
// host, inside the workspace or installing from npm, serves these same files.
export async function buildSqliteWorker(outDir: string): Promise<void> {
  buildSqliteInstance();
  const build = await Bun.build({
    entrypoints: [fileURLToPath(getDefaultDatabaseWorkerEntrypointUrl())],
    format: "esm",
    minify: true,
    target: "browser",
  });
  const [worker] = build.outputs;
  if (!build.success || !worker) {
    throw new AggregateError(build.logs, "Failed to build the SQLite worker");
  }
  // Bun leaves an import it cannot resolve in the bundle instead of failing,
  // and a host serves the worker on its own, so any import left would only
  // fail in the browser.
  const source = await worker.text();
  const unresolved = moduleSpecifiers(source);
  if (unresolved.length > 0) {
    throw new Error(`the SQLite worker still imports ${unresolved.join(", ")}`);
  }
  await mkdir(outDir, { recursive: true });
  await Bun.write(join(outDir, "worker.js"), source);
  await copyFile(
    fileURLToPath(getSqliteWasmAssetUrl()),
    join(outDir, "sqlite3.wasm"),
  );
  await copyFile(
    fileURLToPath(getSqliteLicensesUrl()),
    join(outDir, "sqlite3-licenses.md"),
  );
}

if (import.meta.main) {
  const outDir = process.argv[2];
  if (!outDir) {
    throw new Error("usage: bun scripts/buildSqliteWorker.ts <out-dir>");
  }
  await buildSqliteWorker(outDir);
}
