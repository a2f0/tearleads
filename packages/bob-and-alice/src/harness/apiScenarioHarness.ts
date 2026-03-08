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

interface ApiActor {
  alias: string;
  user: SeededUser;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  fetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text);
}

function isShareRequestMissingFieldsError(
  path: string,
  init: RequestInit | undefined,
  status: number,
  body: string
): boolean {
  return (
    status === 400 &&
    (init?.method ?? 'GET').toUpperCase() === 'POST' &&
    path.includes('/shares') &&
    body.includes('shareType, targetId, and permissionLevel are required')
  );
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

      const actorFetch = (
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
          return fetch(`${baseUrl}${connectMapping.path}`, {
            ...connectInit,
            headers: connectHeaders
          }).then((response) => adaptConnectResponse(response, connectMapping));
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
        let response = await actorFetch(path, init);
        let responseBody = '';
        let retriedShareRequest = false;

        while (!response.ok) {
          responseBody = await response.text();
          if (
            !retriedShareRequest &&
            isShareRequestMissingFieldsError(
              path,
              init,
              response.status,
              responseBody
            )
          ) {
            retriedShareRequest = true;
            response = await actorFetch(path, init);
            continue;
          }
          throw new Error(
            `API error ${String(response.status)} ${response.statusText}: ${responseBody}`
          );
        }

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
