import { expect, test } from "bun:test";
import { ApiRequestMetrics, type Tearleads } from "@tearleads/client-sdk";
import {
  type OpenedReloadSdk,
  openReloadAccount,
  type ReloadAccountServices,
} from "./reloadAccount";

function fakeLocalDb() {
  let closed = false;
  return {
    closed: () => closed,
    open: async () => ({
      client: { exec: async () => ({ rows: [] }) },
      measurements: { calls: 0, durationMs: 0 },
      captureSqlWindow: () => ({
        finish: () => ({
          top: [],
          mutations: 0,
          maxMutationHoldMs: 0,
          maxStatementsPerMutation: 0,
        }),
      }),
      close: () => {
        closed = true;
      },
    }),
  };
}

interface FakeSdkBehavior {
  readonly failRegister?: boolean;
  readonly failImportOnReload?: boolean;
  readonly onCreateChild?: (name: string) => Promise<{ id: string }>;
  readonly onSyncNote?: (text: string) => Promise<boolean>;
}

function fakeSdkInstance(
  id: number,
  events: string[],
  behavior: FakeSdkBehavior = {},
): OpenedReloadSdk {
  const sdk = {
    identity: {
      signingFingerprint: "fp-1",
      generate: async () => ({ seedPhrase: "seed" }),
      exportKeyPackage: async () => ({}),
      importKeyPackage: async () => {
        if (behavior.failImportOnReload) {
          throw new Error("Import failed during reload");
        }
      },
    },
    session: {
      snapshot: {
        authToken: "tok",
        containerId: "root-1",
        defaultOrganizationId: "org-1",
        organizationId: "org-1",
        rootAcknowledgments: [],
        userId: "user-1",
      },
      registerIdentity: async () => {
        if (behavior.failRegister) throw new Error("Register HTTP failed");
        return { challenge: "ch-1" };
      },
      login: async () => true,
      setContext: () => {},
    },
    events: {
      setConnected: () => {},
    },
    deviceFirst: {
      open: () => ({
        containerStore: {
          getSnapshot: () => ({ ready: true }),
          createChild: async (_parent: string, name: string) => {
            if (behavior.onCreateChild) return behavior.onCreateChild(name);
            return { id: `folder-${name}` };
          },
        },
        view: {
          updateRuntime: () => {},
          setActiveContainer: () => {},
        },
      }),
    },
    containerContents: {
      workflowRuntime: () => ({}),
      documentLinks: () => ({
        openDocument: ({ initialText }: { initialText: string }) => ({
          ensureInitialized: async () => true,
          requestRemoteSyncAndWait: async () =>
            behavior.onSyncNote ? behavior.onSyncNote(initialText) : true,
        }),
      }),
    },
    dispose: () => {
      events.push(`dispose:${id}`);
    },
  };
  return {
    sdk: sdk as unknown as Tearleads,
    metrics: new ApiRequestMetrics(),
  };
}

function quietStub(
  events: string[],
): NonNullable<ReloadAccountServices["waitQuiet"]> {
  return () => ({
    totals: () => ({ total: 0, inFlight: 0, endpoints: [] }),
    settled: Promise.resolve().then(() => {
      events.push("quiet");
      return 12;
    }),
  });
}

test("register failure disposes the SDK and closes the local database", async () => {
  const db = fakeLocalDb();
  const events: string[] = [];
  await expect(
    openReloadAccount("http://127.0.0.1:1", 50, {
      openLocalDatabase: db.open,
      openSdk: () => fakeSdkInstance(1, events, { failRegister: true }),
    }),
  ).rejects.toThrow("Register HTTP failed");
  expect(events).toEqual(["dispose:1"]);
  expect(db.closed()).toBe(true);

  const db2 = fakeLocalDb();
  await expect(
    openReloadAccount("http://127.0.0.1:1", 50, {
      openLocalDatabase: db2.open,
      openSdk: () => {
        throw new Error("SDK constructor failed");
      },
    }),
  ).rejects.toThrow("SDK constructor failed");
  expect(db2.closed()).toBe(true);
});

test("close disposes the new SDK when reload startup fails", async () => {
  const db = fakeLocalDb();
  const events: string[] = [];
  let seq = 0;
  const account = await openReloadAccount("http://127.0.0.1:1", 50, {
    openLocalDatabase: db.open,
    openSdk: () => {
      seq += 1;
      return fakeSdkInstance(seq, events, {
        failImportOnReload: seq === 2,
      });
    },
    waitIdle: async () => {},
    waitQuiet: quietStub(events),
  });

  await expect(account.reload()).rejects.toThrow("Import failed during reload");
  // The original SDK was disposed before building SDK #2, and close() disposes SDK #2.
  expect(events).toEqual(["dispose:1"]);
  account.close();
  expect(events).toEqual(["dispose:1", "dispose:2"]);
  expect(db.closed()).toBe(true);
});

test("grow waits for every in-flight create before failing and ends with a quiet window on success", async () => {
  const db = fakeLocalDb();
  const events: string[] = [];
  let secondSettled = false;
  let createIndex = 0;

  const account = await openReloadAccount("http://127.0.0.1:1", 50, {
    openLocalDatabase: db.open,
    openSdk: () =>
      fakeSdkInstance(1, events, {
        onSyncNote: async () => {
          createIndex += 1;
          if (createIndex === 1) throw new Error("first note failed");
          await Bun.sleep(20);
          secondSettled = true;
          return true;
        },
      }),
    waitIdle: async () => {},
    waitQuiet: quietStub(events),
  });

  await expect(account.grow(2, 2)).rejects.toThrow("first note failed");
  expect(secondSettled).toBe(true);
  account.close();

  const db2 = fakeLocalDb();
  const events2: string[] = [];
  const account2 = await openReloadAccount("http://127.0.0.1:1", 50, {
    openLocalDatabase: db2.open,
    openSdk: () => fakeSdkInstance(1, events2),
    waitIdle: async () => {},
    waitQuiet: quietStub(events2),
  });
  await account2.grow(2, 2);
  expect(events2).toEqual(["quiet"]);
  account2.close();
});
