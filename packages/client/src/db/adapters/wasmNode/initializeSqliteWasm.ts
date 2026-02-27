/**
 * SQLite WASM module initialization for Node.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SQLite3InitModule, SQLite3Module } from './types';
import { patchFetchForFileUrls, restoreFetch } from './utils';

declare global {
  var sqlite3InitModuleState:
    | {
        wasmFilename: string;
        debugModule: () => void;
        instantiateWasm?: (
          imports: WebAssembly.Imports,
          onSuccess: (
            instance: WebAssembly.Instance,
            module: WebAssembly.Module
          ) => void
        ) => object;
      }
    | undefined;
}

// Module-level state for caching the initialized SQLite module
let sqlite3: SQLite3Module | null = null;

/**
 * Get the path to the WASM files directory.
 */
function getWasmDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../../../workers/sqlite-wasm');
}

/**
 * Initialize the SQLite WASM module for Node.js.
 * This only needs to run once per process.
 */
export async function initializeSqliteWasm(): Promise<SQLite3Module> {
  if (sqlite3) {
    return sqlite3;
  }

  const wasmDir = getWasmDir();
  // IMPORTANT: DO NOT change .js back to .mjs - see issue #670
  // Android WebView requires .js for proper MIME type handling.
  // See: https://github.com/apache/cordova-android/issues/1142
  const modulePath = path.join(wasmDir, 'sqlite3.js');
  const wasmPath = path.join(wasmDir, 'sqlite3.wasm');

  // Verify the files exist
  if (!fs.existsSync(modulePath)) {
    throw new Error(
      `SQLite WASM module not found at ${modulePath}. ` +
        'Run ./scripts/downloadSqliteWasm.sh to download it.'
    );
  }
  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      `SQLite WASM binary not found at ${wasmPath}. ` +
        'Run ./scripts/downloadSqliteWasm.sh to download it.'
    );
  }

  // Set up globalThis.sqlite3InitModuleState BEFORE importing the module.
  // Force a fetch-free instantiate path so Node tests are independent of
  // whichever Response/fetch implementation the DOM test environment installs.
  patchFetchForFileUrls();
  globalThis.sqlite3InitModuleState = {
    wasmFilename: 'sqlite3.wasm',
    debugModule: () => {},
    instantiateWasm: (
      imports: WebAssembly.Imports,
      onSuccess: (
        instance: WebAssembly.Instance,
        module: WebAssembly.Module
      ) => void
    ): object => {
      void WebAssembly.instantiate(fs.readFileSync(wasmPath), imports).then(
        ({ instance, module }) => {
          onSuccess(instance, module);
        }
      );
      // Async instantiate path expected by Emscripten.
      return {};
    }
  };

  const wasmWithOptionalInstantiateStreaming = WebAssembly as unknown as {
    instantiateStreaming: typeof WebAssembly.instantiateStreaming | undefined;
  };
  const originalInstantiateStreaming =
    wasmWithOptionalInstantiateStreaming.instantiateStreaming;
  wasmWithOptionalInstantiateStreaming.instantiateStreaming = undefined;

  try {
    // Import the WASM module
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const wasmModule = await import(/* @vite-ignore */ modulePath);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const initModule: SQLite3InitModule | undefined = wasmModule.default;

    if (!initModule) {
      throw new Error('Failed to load sqlite3InitModule from module');
    }

    // Initialize with Node.js-compatible settings
    sqlite3 = await initModule({
      print: console.log,
      printErr: console.error
    });

    if (!sqlite3 || !sqlite3.oo1 || !sqlite3.capi) {
      throw new Error('SQLite module loaded but missing expected properties');
    }

    return sqlite3;
  } finally {
    wasmWithOptionalInstantiateStreaming.instantiateStreaming =
      originalInstantiateStreaming;
    restoreFetch();
  }
}
