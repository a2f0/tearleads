import { sql } from "drizzle-orm";
import {
  apiPostgresAdapterModuleUrl,
  appTestRuntimeModuleUrl,
} from "./apiModuleUrls";
import { eventRouter } from "./eventsSocket";
import { createInMemoryKeyValueStore } from "./keyValueStore";

let testApiAppPromise: Promise<TestApiApp> | null = null;

interface AppTestProcessState {
  hasLoadedApiRuntimeModule: boolean;
}

const appTestProcessState = globalThis as typeof globalThis & {
  __tearleadsAppTestProcessState?: AppTestProcessState;
};

function getOrCreateTestProcessState(): AppTestProcessState {
  const existing = appTestProcessState.__tearleadsAppTestProcessState;
  if (existing) {
    return existing;
  }

  const created: AppTestProcessState = {
    hasLoadedApiRuntimeModule: false,
  };
  appTestProcessState.__tearleadsAppTestProcessState = created;
  return created;
}

const testProcessState = getOrCreateTestProcessState();

interface TestApiApp {
  fetch: (request: Request) => Promise<Response>;
}

export async function ensureTestApiApp(): Promise<TestApiApp> {
  if (testApiAppPromise) {
    return testApiAppPromise;
  }

  testProcessState.hasLoadedApiRuntimeModule = true;
  testApiAppPromise = (async () => {
    const [
      { initializeApiDatabase },
      {
        createDestroySession,
        createDestroyUserSession,
        createListUserSessions,
        createMemoryBlobObjectStore,
        createRequireAuth,
        createRouteApp,
        createSessionTokenIssuer,
        db,
      },
    ] = await Promise.all([
      import(apiPostgresAdapterModuleUrl),
      import(appTestRuntimeModuleUrl),
    ]);

    if (typeof initializeApiDatabase !== "function") {
      throw new Error(
        "API postgres adapter module missing initializeApiDatabase export.",
      );
    }
    if (typeof createRouteApp !== "function") {
      throw new Error("API routeApp module missing createRouteApp export.");
    }
    if (typeof createDestroySession !== "function") {
      throw new Error(
        "API session module missing createDestroySession export.",
      );
    }
    if (typeof createDestroyUserSession !== "function") {
      throw new Error(
        "API session module missing createDestroyUserSession export.",
      );
    }
    if (typeof createListUserSessions !== "function") {
      throw new Error(
        "API session module missing createListUserSessions export.",
      );
    }
    if (typeof createMemoryBlobObjectStore !== "function") {
      throw new Error(
        "API app test runtime module missing createMemoryBlobObjectStore export.",
      );
    }
    if (typeof createRequireAuth !== "function") {
      throw new Error("API session module missing createRequireAuth export.");
    }
    if (typeof createSessionTokenIssuer !== "function") {
      throw new Error(
        "API session module missing createSessionTokenIssuer export.",
      );
    }
    if (!db) {
      throw new Error("API app test runtime module missing db export.");
    }
    await initializeApiDatabase();

    const keyValueStore = createInMemoryKeyValueStore();
    const eventPublisher = {
      publish: async (event: Record<string, unknown>) => {
        await eventRouter.publish(event);
      },
    };
    const runtime = {
      blobObjectStore: createMemoryBlobObjectStore(),
      db,
      documentSyncCursorHmacKey: "tearleads-test-document-sync-cursor-hmac-key",
      eventPublisher,
      identityTrustDomain: "http://localhost:3001",
      keyValueStore,
      sessionTokenIssuer: {
        createSession: createSessionTokenIssuer(
          keyValueStore.set,
          keyValueStore.sadd,
          keyValueStore.expire,
        ),
      },
    };
    const routeApp = createRouteApp({
      destroySession: createDestroySession(
        keyValueStore.get,
        keyValueStore.del,
        keyValueStore.srem,
      ),
      destroyUserSession: createDestroyUserSession(
        keyValueStore.get,
        keyValueStore.del,
        keyValueStore.srem,
      ),
      listUserSessions: createListUserSessions(
        keyValueStore.get,
        keyValueStore.srem,
        keyValueStore.sscanMembers,
      ),
      publish: (event: Record<string, unknown>) =>
        eventPublisher.publish(event),
      requireAuth: createRequireAuth(
        keyValueStore.get,
        keyValueStore.setKeepTtl,
      ),
      runtime,
    });

    return {
      fetch: (request: Request) => routeApp.fetch(request),
    };
  })();

  return testApiAppPromise;
}

function quoteSqlIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unexpected API test table name: ${identifier}`);
  }

  return `"${identifier}"`;
}

export async function resetTestApiDatabase(): Promise<void> {
  if (!testApiAppPromise) {
    return;
  }

  const [{ initializeApiDatabase }, { db }] = await Promise.all([
    import(apiPostgresAdapterModuleUrl),
    import(appTestRuntimeModuleUrl),
  ]);
  if (typeof initializeApiDatabase !== "function") {
    throw new Error(
      "API postgres adapter module missing initializeApiDatabase export.",
    );
  }
  if (!db) {
    throw new Error("API app test runtime module missing db export.");
  }

  await initializeApiDatabase();

  const tableResult = await db.execute(sql<{ tableName: string }>`
    select tablename as "tableName"
    from pg_catalog.pg_tables
    where schemaname = 'public'
      and tablename <> '__drizzle_migrations'
    order by tablename
  `);
  const tableNames = tableResult.rows.map(
    (row: { tableName: string }) => row.tableName,
  );
  if (tableNames.length === 0) {
    return;
  }

  await db.execute(
    sql.raw(
      `truncate table ${tableNames.map(quoteSqlIdentifier).join(", ")} restart identity cascade`,
    ),
  );
}

export function forgetTestApiApp(): void {
  testApiAppPromise = null;
}
