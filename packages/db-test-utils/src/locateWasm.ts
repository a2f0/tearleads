/**
 * Helper to locate SQLite WASM files in the monorepo.
 *
 * This helper finds SQLite WASM artifacts from anywhere in the monorepo,
 * preferring package-local locations and falling back to legacy paths.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WASM_SUBPATH_CANDIDATES = [
  'packages/db-test-utils/sqlite-wasm',
  'packages/client/src/workers/sqlite-wasm'
];
const REQUIRED_FILES = ['sqlite3.js', 'sqlite3.wasm'];

/**
 * Locate the SQLite WASM directory by walking up the directory tree.
 *
 * @param startDir - Directory to start searching from (defaults to this file's directory)
 * @returns Absolute path to the sqlite-wasm directory
 * @throws Error if WASM files cannot be found
 */
export function locateWasmDir(startDir?: string): string {
  const searchStart = startDir ?? path.dirname(fileURLToPath(import.meta.url));

  let currentDir = searchStart;
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    for (const subpath of WASM_SUBPATH_CANDIDATES) {
      const candidatePath = path.join(currentDir, subpath);

      if (fs.existsSync(candidatePath)) {
        const missingFiles = REQUIRED_FILES.filter(
          (file) => !fs.existsSync(path.join(candidatePath, file))
        );

        if (missingFiles.length === 0) {
          return candidatePath;
        }
      }
    }

    currentDir = path.dirname(currentDir);
  }

  throw new Error(
    `SQLite WASM files not found. Searched from ${searchStart} up to filesystem root.\n` +
      `Expected one of:\n- ${WASM_SUBPATH_CANDIDATES.join('\n- ')}\n` +
      `Run ./scripts/downloadSqliteWasm.sh to download the WASM files.`
  );
}

/**
 * Check if the WASM files exist at a given path.
 *
 * @param wasmDir - Path to check
 * @returns true if all required files exist
 */
export function wasmFilesExist(wasmDir: string): boolean {
  if (!fs.existsSync(wasmDir)) {
    return false;
  }

  return REQUIRED_FILES.every((file) =>
    fs.existsSync(path.join(wasmDir, file))
  );
}
