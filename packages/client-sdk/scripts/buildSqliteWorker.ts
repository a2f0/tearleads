import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteLicensesUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";

// Writes the files a host serves for createSQLiteRuntime: the worker as one
// self-contained module, the SQLite WebAssembly it loads from beside itself
// (resolved against the module's own URL), and the licenses both carry. Every
// host, inside the workspace or installing from npm, serves these same files.
export async function buildSqliteWorker(outDir: string): Promise<void> {
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
  await mkdir(outDir, { recursive: true });
  await Bun.write(join(outDir, "worker.js"), worker);
  await copyFile(
    fileURLToPath(getSqliteWasmAssetUrl()),
    join(outDir, "sqlite3.wasm"),
  ).catch((error: unknown) => {
    throw new Error(
      "sqlite3.wasm is missing; run `bun run build:packages` first",
      { cause: error },
    );
  });
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
