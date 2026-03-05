import { isRecord } from '@tearleads/shared';
import { importApiV2ClientWasmModule } from './apiV2ClientWasmImport';

interface ApiV2ClientWasmBindings {
  default?: () => Promise<void>;
  normalizeConnectBaseUrl: (baseUrl: string) => string;
  resolveRpcPath: (serviceName: string, methodName: string) => string;
  getProtocolConfig: () => unknown;
  buildRequestHeaders: (
    bearerToken?: string | null,
    organizationId?: string | null
  ) => unknown;
}

export interface ApiV2ProtocolConfig {
  connectPrefix: string;
  adminServiceName: string;
  mlsServiceName: string;
  authorizationHeader: string;
  organizationHeader: string;
}

export interface ApiV2AdminRpcPaths {
  getPostgresInfo: string;
  getTables: string;
  getColumns: string;
  getRows: string;
  getRedisKeys: string;
  getRedisValue: string;
  deleteRedisKey: string;
  getRedisDbSize: string;
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
    typeof module['resolveRpcPath'] !== 'function' ||
    typeof module['getProtocolConfig'] !== 'function' ||
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

function parseProtocolConfig(envelope: unknown): ApiV2ProtocolConfig {
  if (!isRecord(envelope)) {
    throw new Error('api-v2 wasm protocol config must be an object');
  }

  const connectPrefix = envelope['connectPrefix'];
  const adminServiceName = envelope['adminServiceName'];
  const mlsServiceName = envelope['mlsServiceName'];
  const authorizationHeader = envelope['authorizationHeader'];
  const organizationHeader = envelope['organizationHeader'];

  if (
    typeof connectPrefix !== 'string' ||
    typeof adminServiceName !== 'string' ||
    typeof mlsServiceName !== 'string' ||
    typeof authorizationHeader !== 'string' ||
    typeof organizationHeader !== 'string'
  ) {
    throw new Error(
      'api-v2 wasm protocol config must include string protocol constants'
    );
  }

  return {
    connectPrefix,
    adminServiceName,
    mlsServiceName,
    authorizationHeader,
    organizationHeader
  };
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

export async function getApiV2ProtocolConfig(): Promise<ApiV2ProtocolConfig> {
  const bindings = await loadApiV2ClientWasmBindings();
  return parseProtocolConfig(bindings.getProtocolConfig());
}

export async function resolveApiV2RpcPath(
  serviceName: string,
  methodName: string
): Promise<string> {
  const normalizedService = serviceName.trim();
  const normalizedMethod = methodName.trim();
  if (normalizedService.length === 0) {
    throw new Error('service name must not be empty');
  }
  if (normalizedMethod.length === 0) {
    throw new Error('method name must not be empty');
  }

  const bindings = await loadApiV2ClientWasmBindings();
  return bindings.resolveRpcPath(normalizedService, normalizedMethod);
}

export async function getApiV2AdminRpcPaths(): Promise<ApiV2AdminRpcPaths> {
  const config = await getApiV2ProtocolConfig();
  const serviceName = config.adminServiceName;

  return {
    getPostgresInfo: await resolveApiV2RpcPath(serviceName, 'GetPostgresInfo'),
    getTables: await resolveApiV2RpcPath(serviceName, 'GetTables'),
    getColumns: await resolveApiV2RpcPath(serviceName, 'GetColumns'),
    getRows: await resolveApiV2RpcPath(serviceName, 'GetRows'),
    getRedisKeys: await resolveApiV2RpcPath(serviceName, 'GetRedisKeys'),
    getRedisValue: await resolveApiV2RpcPath(serviceName, 'GetRedisValue'),
    deleteRedisKey: await resolveApiV2RpcPath(serviceName, 'DeleteRedisKey'),
    getRedisDbSize: await resolveApiV2RpcPath(serviceName, 'GetRedisDbSize')
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
