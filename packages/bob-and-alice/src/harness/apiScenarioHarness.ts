import {
  createTestContext,
  type SeededUser,
  seedTestUser,
  type TestContext,
  type TestContextDeps
} from '@tearleads/api-test-utils';

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
    const ctx = await createTestContext(getDeps);
    const actorMap = new Map<string, ApiActor>();

    for (const def of actorDefs) {
      const user = await seedTestUser(ctx, { admin: def.admin ?? false });
      const baseUrl = `http://localhost:${String(ctx.port)}/v1`;

      const actorFetch = (
        path: string,
        init?: RequestInit
      ): Promise<Response> =>
        fetch(`${baseUrl}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${user.accessToken}`,
            ...init?.headers
          }
        });

      const actorFetchJson = async <T = unknown>(
        path: string,
        init?: RequestInit
      ): Promise<T> => {
        const response = await actorFetch(path, init);
        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `API error ${String(response.status)} ${response.statusText}: ${body}`
          );
        }
        const text = await response.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
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

  actors(): ApiActor[] {
    return [...this.actorMap.values()];
  }

  async teardown(): Promise<void> {
    await this.ctx.teardown();
  }
}
