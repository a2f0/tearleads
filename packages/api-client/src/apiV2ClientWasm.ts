import { isRecord } from '@tearleads/shared';
import { importApiV2ClientWasmModule } from './apiV2ClientWasmImport';

interface ApiV2ClientWasmBindings {
  default?: () => Promise<void>;
  normalizeConnectBaseUrl: (baseUrl: string) => string;
  adminGetPostgresInfoPath: () => string;
  adminGetTablesPath: () => string;
  adminGetColumnsPath: () => string;
  adminGetRedisKeysPath: () => string;
  adminGetRedisValuePath: () => string;
  buildRequestHeaders: (
    bearerToken?: string | null,
    organizationId?: string | null
  ) => unknown;
}

export interface ApiV2AdminRpcPaths {
  getPostgresInfo: string;
  getTables: string;
  getColumns: string;
  getRedisKeys: string;
  getRedisValue: string;
}

export interface ApiV2RequestHeaderOptions {
  bearerToken?: string | null;
  organizationId?: string | null;
}

let apiV2ClientWasmBindingsPromise: Promise<ApiV2ClientWasmBindings> | null =
  null;

function assertApiV2ClientWasmBindings(
  module: unknown
): asserts module is ApiV2ClientWasmBindings {
  if (
    !isRecord(module) ||
    typeof module['normalizeConnectBaseUrl'] !== 'function' ||
    typeof module['adminGetPostgresInfoPath'] !== 'function' ||
    typeof module['adminGetTablesPath'] !== 'function' ||
    typeof module['adminGetColumnsPath'] !== 'function' ||
    typeof module['adminGetRedisKeysPath'] !== 'function' ||
    typeof module['adminGetRedisValuePath'] !== 'function' ||
    typeof module['buildRequestHeaders'] !== 'function'
  ) {
    throw new Error(
      'WASM module does not export expected api-v2 client bindings. Run: pnpm codegenWasm'
    );
  }
}

function parseHeaderMap(envelope: unknown): Record<string, string> {
  if (!isRecord(envelope)) {
    throw new Error('api-v2 wasm header envelope must be an object');
  }

  const headers = envelope['headers'];
  if (!isRecord(headers)) {
    throw new Error('api-v2 wasm header envelope must include object headers');
  }

  const parsedHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      throw new Error(`api-v2 wasm header "${name}" must be a string`);
    }
    parsedHeaders[name] = value;
  }

  return parsedHeaders;
}

async function loadApiV2ClientWasmBindings(): Promise<ApiV2ClientWasmBindings> {
  if (apiV2ClientWasmBindingsPromise) {
    return apiV2ClientWasmBindingsPromise;
  }

  const pendingBindings = (async () => {
    const module = await importApiV2ClientWasmModule();
    assertApiV2ClientWasmBindings(module);

    if (module.default) {
      await module.default();
    }

    return module;
  })();

  apiV2ClientWasmBindingsPromise = pendingBindings.catch((error: unknown) => {
    apiV2ClientWasmBindingsPromise = null;
    throw error;
  });

  return apiV2ClientWasmBindingsPromise;
}

export async function normalizeApiV2ConnectBaseUrl(
  apiBaseUrl: string
): Promise<string> {
  const bindings = await loadApiV2ClientWasmBindings();
  return bindings.normalizeConnectBaseUrl(apiBaseUrl);
}

export async function getApiV2AdminRpcPaths(): Promise<ApiV2AdminRpcPaths> {
  const bindings = await loadApiV2ClientWasmBindings();
  return {
    getPostgresInfo: bindings.adminGetPostgresInfoPath(),
    getTables: bindings.adminGetTablesPath(),
    getColumns: bindings.adminGetColumnsPath(),
    getRedisKeys: bindings.adminGetRedisKeysPath(),
    getRedisValue: bindings.adminGetRedisValuePath()
  };
}

export async function buildApiV2RequestHeaders(
  options: ApiV2RequestHeaderOptions = {}
): Promise<Record<string, string>> {
  const bindings = await loadApiV2ClientWasmBindings();
  const headers = bindings.buildRequestHeaders(
    options.bearerToken ?? null,
    options.organizationId ?? null
  );

  return parseHeaderMap(headers);
}
