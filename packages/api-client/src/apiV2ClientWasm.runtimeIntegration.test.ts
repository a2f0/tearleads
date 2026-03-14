import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from '@tearleads/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApiV2RequestHeaders,
  getApiV2ProtocolConfig,
  normalizeApiV2ConnectBaseUrl,
  resetApiV2ClientWasmRuntimeForTesting,
  resolveApiV2RpcPath
} from './apiV2ClientWasm';

interface ApiV2GeneratedWasmBindings {
  default: (options: { module_or_path: Uint8Array }) => Promise<unknown>;
  normalizeConnectBaseUrl: (baseUrl: string) => string;
  resolveRpcPath: (serviceName: string, methodName: string) => string;
  getProtocolConfig: () => unknown;
  buildRequestHeaders: (
    bearerToken?: string | null,
    organizationId?: string | null
  ) => unknown;
}

const GLOBAL_API_V2_WASM_IMPORTER_KEY =
  '__tearleadsImportApiV2ClientWasmModule';

function isApiV2GeneratedWasmBindings(
  value: unknown
): value is ApiV2GeneratedWasmBindings {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['default'] === 'function' &&
    typeof value['normalizeConnectBaseUrl'] === 'function' &&
    typeof value['resolveRpcPath'] === 'function' &&
    typeof value['getProtocolConfig'] === 'function' &&
    typeof value['buildRequestHeaders'] === 'function'
  );
}

async function loadGeneratedWasmBindings(): Promise<ApiV2GeneratedWasmBindings> {
  const moduleCandidate: unknown = await import(
    '../.generated/apiClientWasm/tearleads_api_client_wasm.js'
  );

  if (!isApiV2GeneratedWasmBindings(moduleCandidate)) {
    throw new Error(
      'generated api-v2 wasm bindings are missing expected exports'
    );
  }

  return moduleCandidate;
}

function installRealWasmImporter(bindings: ApiV2GeneratedWasmBindings): void {
  let pendingInitialization: Promise<void> | null = null;

  Reflect.set(globalThis, GLOBAL_API_V2_WASM_IMPORTER_KEY, async () => {
    if (pendingInitialization === null) {
      pendingInitialization = (async () => {
        const candidatePaths = [
          join(
            process.cwd(),
            '.generated',
            'apiClientWasm',
            'tearleads_api_client_wasm_bg.wasm'
          ),
          join(
            process.cwd(),
            'packages',
            'api-client',
            '.generated',
            'apiClientWasm',
            'tearleads_api_client_wasm_bg.wasm'
          )
        ];
        let wasmModulePath: string | null = null;

        for (const candidatePath of candidatePaths) {
          try {
            await access(candidatePath);
            wasmModulePath = candidatePath;
            break;
          } catch {
            // Try the next candidate.
          }
        }

        if (wasmModulePath === null) {
          throw new Error(
            `Could not locate generated api-client WASM binary. Checked: ${candidatePaths.join(', ')}`
          );
        }

        const wasmBytes = new Uint8Array(await readFile(wasmModulePath));
        await bindings.default({ module_or_path: wasmBytes });
      })();
    }

    await pendingInitialization;
    return bindings;
  });
}

describe('apiV2ClientWasm runtime integration', () => {
  beforeEach(() => {
    resetApiV2ClientWasmRuntimeForTesting();
    Reflect.deleteProperty(globalThis, GLOBAL_API_V2_WASM_IMPORTER_KEY);
  });

  afterEach(() => {
    resetApiV2ClientWasmRuntimeForTesting();
    Reflect.deleteProperty(globalThis, GLOBAL_API_V2_WASM_IMPORTER_KEY);
  });

  it('loads generated wasm bindings and resolves canonical protocol values', async () => {
    const bindings = await loadGeneratedWasmBindings();
    installRealWasmImporter(bindings);

    await expect(
      normalizeApiV2ConnectBaseUrl('https://api.example.test/v2')
    ).resolves.toBe('https://api.example.test/v2/connect');
    await expect(
      resolveApiV2RpcPath('tearleads.v2.AdminService', 'GetRedisDbSize')
    ).resolves.toBe('/tearleads.v2.AdminService/GetRedisDbSize');
    await expect(getApiV2ProtocolConfig()).resolves.toEqual({
      connectPrefix: '/connect',
      adminServiceName: 'tearleads.v2.AdminService',
      mlsServiceName: 'tearleads.v2.MlsService',
      authorizationHeader: 'authorization',
      organizationHeader: 'x-tearleads-organization-id'
    });
  });

  it('preserves auth and organization headers from real wasm map envelopes', async () => {
    const bindings = await loadGeneratedWasmBindings();
    installRealWasmImporter(bindings);

    await expect(
      buildApiV2RequestHeaders({
        bearerToken: 'token-abc',
        organizationId: 'org_123'
      })
    ).resolves.toEqual({
      authorization: 'Bearer token-abc',
      'x-tearleads-organization-id': 'org_123'
    });
  });
});
