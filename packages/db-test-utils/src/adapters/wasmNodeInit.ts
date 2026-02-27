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

export function patchFetchForFileUrls(): void {
  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    let directFilePath: string | null = null;
    if (typeof input !== 'string') {
      try {
        directFilePath = fileURLToPath(input as URL);
      } catch {
        directFilePath = null;
      }
    }
    if (directFilePath) {
      const buffer = fs.readFileSync(directFilePath);
      const dataUrl = `data:application/wasm;base64,${buffer.toString('base64')}`;
      return originalFetch(dataUrl, init);
    }

    const requestLike = input as {
      href?: unknown;
      url?: unknown;
      protocol?: unknown;
      pathname?: unknown;
      toString?: () => string;
    };
    const possibleUrls: string[] = [];
    if (typeof input === 'string') {
      possibleUrls.push(input);
    }
    if (typeof requestLike.href === 'string') {
      possibleUrls.push(requestLike.href);
    } else if (requestLike.href) {
      possibleUrls.push(String(requestLike.href));
    }
    if (typeof requestLike.url === 'string') {
      possibleUrls.push(requestLike.url);
    } else if (requestLike.url) {
      possibleUrls.push(String(requestLike.url));
    }
    if (
      requestLike.protocol === 'file:' &&
      typeof requestLike.pathname === 'string'
    ) {
      possibleUrls.push(`file://${requestLike.pathname}`);
    }
    try {
      const jsonString = JSON.stringify(input);
      if (typeof jsonString === 'string') {
        possibleUrls.push(jsonString);
      }
    } catch {
      // ignore serialization failures
    }
    possibleUrls.push(String(input));

    const url =
      possibleUrls.find((candidate) => candidate.includes('://')) ??
      possibleUrls[0] ??
      '';

    if (url.startsWith('file://')) {
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
  const wasmWithOptionalInstantiateStreaming = WebAssembly as WebAssembly & {
    instantiateStreaming?: typeof WebAssembly.instantiateStreaming;
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
