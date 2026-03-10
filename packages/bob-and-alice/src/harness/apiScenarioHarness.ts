import type {
  SeededUser,
  TestContext,
  TestContextDeps
} from '@tearleads/api-test-utils';
import { createConnectJsonPostInit } from '@tearleads/shared';
import {
  adaptConnectResponse,
  type ConnectRouteMapping,
  mapLegacyPathToConnect,
  mergeHeaders,
  resolveDirectApiPath
} from './apiScenarioConnectCompat.js';
import { getApiTestUtils } from './getApiTestUtils.js';

export interface ApiActorDefinition {
  alias: string;
  admin?: boolean;
}

interface RetryableWriteOptions {
  maxRetryAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ApiActor {
  alias: string;
  user: SeededUser;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  fetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryDelayMs(retryAttempt: number): number {
  return Math.min(250, 25 * 2 ** (retryAttempt - 1));
}

async function normalizeRequestBodyForRetries(
  body: RequestInit['body']
): Promise<RequestInit['body']> {
  if (body === null || body === undefined) {
    return body;
  }
  if (typeof body === 'string' || body instanceof String) {
    return body.toString();
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof ArrayBuffer) {
    return body.slice(0);
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    );
  }
  if (body instanceof Blob) {
    return await body.text();
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return await new Response(body).text();
  }
  return body;
}

async function normalizeRequestInitForRetries(
  init: RequestInit | undefined
): Promise<RequestInit | undefined> {
  if (!init) {
    return init;
  }

  const normalizedBody = await normalizeRequestBodyForRetries(init.body);
  if (normalizedBody === undefined) {
    const { body: _body, ...rest } = init;
    return rest;
  }

  return {
    ...init,
    body: normalizedBody
  };
}

function cloneRequestBodyForRetry(
  body: RequestInit['body']
): RequestInit['body'] {
  if (body === null || body === undefined) {
    return body;
  }
  if (typeof body === 'string' || body instanceof String) {
    return body.toString();
  }
  if (body instanceof URLSearchParams) {
    return new URLSearchParams(body.toString());
  }
  if (body instanceof ArrayBuffer) {
    return body.slice(0);
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    );
  }
  return body;
}

function cloneRequestInitForRetry(
  init: RequestInit | undefined
): RequestInit | undefined {
  if (!init) {
    return init;
  }

  const clonedBody = cloneRequestBodyForRetry(init.body);
  const clonedHeaders = init.headers ? new Headers(init.headers) : undefined;
  const clonedInit: RequestInit = {
    ...init,
    ...(clonedHeaders ? { headers: clonedHeaders } : {}),
    ...(clonedBody === undefined ? {} : { body: clonedBody })
  };
  if (clonedBody === undefined) {
    delete clonedInit.body;
  }
  return clonedInit;
}

function formatRetryRequestBody(body: RequestInit['body']): string {
  const maxPreviewLength = 200;
  if (body === null) {
    return 'null';
  }
  if (body === undefined) {
    return 'undefined';
  }
  if (typeof body === 'string' || body instanceof String) {
    const preview = body.toString().slice(0, maxPreviewLength);
    return `string:${preview}`;
  }
  if (body instanceof URLSearchParams) {
    const preview = body.toString().slice(0, maxPreviewLength);
    return `urlsearchparams:${preview}`;
  }
  if (body instanceof ArrayBuffer) {
    return `arraybuffer:${String(body.byteLength)}`;
  }
  if (ArrayBuffer.isView(body)) {
    return `view:${String(body.byteLength)}`;
  }
  return `type:${typeof body}`;
}

export function isRetryableWriteValidationError(
  path: string,
  init: RequestInit | undefined,
  status: number,
  body: string
): boolean {
  const isPost = (init?.method ?? 'GET').toUpperCase() === 'POST';
  if (status !== 400 || !isPost) {
    return false;
  }

  const isShareRoute = path.includes('/shares');
  if (
    isShareRoute &&
    body.includes('shareType, targetId, and permissionLevel are required')
  ) {
    return true;
  }

  const isRegisterRoute =
    /\/vfs\/register(?:$|[/?#])/.test(path) ||
    /\/connect\/tearleads\.v2\.VfsService\/Register(?:$|[/?#])/.test(path);
  return (
    isRegisterRoute &&
    body.includes('id, objectType, and encryptedSessionKey are required')
  );
}

export async function fetchWithRetryableWriteValidationError(
  actorFetch: (path: string, init?: RequestInit) => Promise<Response>,
  path: string,
  init?: RequestInit,
  options: RetryableWriteOptions = {}
): Promise<Response> {
  const maxRetryAttempts = options.maxRetryAttempts ?? 8;
  const sleep = options.sleep ?? defaultSleep;
  const retryInitTemplate = await normalizeRequestInitForRetries(init);

  let retryAttempts = 0;
  let response = await actorFetch(
    path,
    cloneRequestInitForRetry(retryInitTemplate)
  );
  while (!response.ok) {
    const responseBody = await response.text();
    const shouldRetry = isRetryableWriteValidationError(
      path,
      retryInitTemplate,
      response.status,
      responseBody
    );
    if (!shouldRetry || retryAttempts >= maxRetryAttempts) {
      throw new Error(
        `API error ${String(response.status)} ${response.statusText}: ${responseBody} (path=${path} requestBody=${formatRetryRequestBody(retryInitTemplate?.body)})`
      );
    }

    retryAttempts += 1;
    await sleep(retryDelayMs(retryAttempts));
    response = await actorFetch(
      path,
      cloneRequestInitForRetry(retryInitTemplate)
    );
  }

  return response;
}

export class ApiScenarioHarness {
  readonly ctx: TestContext;
  private readonly actorMap: Map<string, ApiActor>;

  private constructor(ctx: TestContext, actorMap: Map<string, ApiActor>) {
    this.ctx = ctx;
    this.actorMap = actorMap;
  }

  static async create(
    actorDefs: ApiActorDefinition[],
    getDeps: () => Promise<TestContextDeps>
  ): Promise<ApiScenarioHarness> {
    const { createTestContext, seedTestUser } = await getApiTestUtils();
    const ctx = await createTestContext(getDeps);
    const actorMap = new Map<string, ApiActor>();

    for (const def of actorDefs) {
      const user = await seedTestUser(ctx, { admin: def.admin ?? false });
      const baseUrl = `http://localhost:${String(ctx.port)}`;

      const actorFetch = async (
        path: string,
        init?: RequestInit
      ): Promise<Response> => {
        const connectMapping: ConnectRouteMapping | null =
          mapLegacyPathToConnect(path, init);
        if (connectMapping) {
          const connectInit = createConnectJsonPostInit(connectMapping.body);
          const connectHeaders = mergeHeaders(
            user.accessToken,
            connectInit.headers,
            user.organizationId
          );
          const connectResponse = await fetch(
            `${baseUrl}${connectMapping.path}`,
            {
              ...connectInit,
              headers: connectHeaders
            }
          ).then((response) => adaptConnectResponse(response, connectMapping));
          return connectResponse;
        }

        return fetch(`${baseUrl}${resolveDirectApiPath(path)}`, {
          ...init,
          headers: mergeHeaders(
            user.accessToken,
            init?.headers,
            user.organizationId
          )
        });
      };

      const actorFetchJson = async <T = unknown>(
        path: string,
        init?: RequestInit
      ): Promise<T> => {
        const response = await fetchWithRetryableWriteValidationError(
          actorFetch,
          path,
          init
        );

        const text = await response.text();
        if (text.trim().length === 0) {
          return parseJson<T>('{}');
        }
        return parseJson<T>(text);
      };

      actorMap.set(def.alias, {
        alias: def.alias,
        user,
        fetch: actorFetch,
        fetchJson: actorFetchJson
      });
    }

    return new ApiScenarioHarness(ctx, actorMap);
  }

  actor(alias: string): ApiActor {
    const a = this.actorMap.get(alias);
    if (!a) throw new Error(`Unknown actor: ${alias}`);
    return a;
  }

  async teardown(): Promise<void> {
    await this.ctx.teardown();
  }
}
