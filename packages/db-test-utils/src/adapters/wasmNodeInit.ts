import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateWasmDir } from '../locateWasm.js';
import type { SQLite3InitModule, SQLite3Module } from './wasmNodeTypes.js';

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

const originalFetch = globalThis.fetch;
let sqlite3: SQLite3Module | null = null;
let cachedWasmDir: string | null = null;

function getStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const property = Reflect.get(value, key);
  return typeof property === 'string' ? property : null;
}

function resolveFetchInputUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  const url = getStringProperty(input, 'url');
  if (url) {
    return url;
  }
  const href = getStringProperty(input, 'href');
  if (href) {
    return href;
  }
  const fallback = String(input);
  return fallback.includes('://') ? fallback : null;
}

export function patchFetchForFileUrls(): void {
  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = resolveFetchInputUrl(input);

    if (typeof url === 'string' && url.startsWith('file://')) {
      const filePath = fileURLToPath(url);
      const buffer = fs.readFileSync(filePath);
      const dataUrl = `data:application/wasm;base64,${buffer.toString('base64')}`;
      return originalFetch(dataUrl, init);
    }

    return originalFetch(input, init);
  };
}

export function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
}

function getWasmDir(configuredDir?: string): string {
  if (configuredDir) {
    return configuredDir;
  }
  if (cachedWasmDir) {
    return cachedWasmDir;
  }
  cachedWasmDir = locateWasmDir();
  return cachedWasmDir;
}

export async function initializeSqliteWasm(
  wasmDir?: string
): Promise<SQLite3Module> {
  if (sqlite3) {
    return sqlite3;
  }

  const resolvedWasmDir = getWasmDir(wasmDir);
  const modulePath = path.join(resolvedWasmDir, 'sqlite3.js');
  const wasmPath = path.join(resolvedWasmDir, 'sqlite3.wasm');

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

  patchFetchForFileUrls();
  const wasmWithOptionalInstantiateStreaming = WebAssembly as unknown as {
    instantiateStreaming: typeof WebAssembly.instantiateStreaming | undefined;
  };
  const originalInstantiateStreaming =
    wasmWithOptionalInstantiateStreaming.instantiateStreaming;
  wasmWithOptionalInstantiateStreaming.instantiateStreaming = undefined;

  try {
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
        return {};
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const wasmModule = await import(/* @vite-ignore */ modulePath);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const initModule: SQLite3InitModule | undefined = wasmModule.default;

    if (!initModule) {
      throw new Error('Failed to load sqlite3InitModule from module');
    }

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
