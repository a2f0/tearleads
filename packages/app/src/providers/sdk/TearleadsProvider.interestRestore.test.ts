import { expect, test } from "bun:test";
import {
  getOrCreateDomainSyncCoordinator,
  Tearleads,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "@testing-library/react";
import { startContainerInterestDeclaration } from "./serverEventsBinding";
import {
  acknowledgeInitialDeclaration,
  createFakeStore,
  fakeSocket,
  tearleadsWithStore,
} from "./test/containerInterestHarness";

test("#3289: rebinds an open socket when SQLite finishes booting after a restore reload", async () => {
  const { close: closeDb, execSql } = await createTestExecSql(
    "interest-restore-delayed-sqlite",
  );
  const seedSdk = new Tearleads({
    database: { execSql, id: "seed-db" },
    logger: { log: () => undefined, logError: () => undefined },
  });
  const { containerId: rootId } =
    await seedSdk.session.bootstrapLocalRootContainer();
  seedSdk.dispose();
  const orgId = crypto.randomUUID();

  const errors: unknown[] = [];
  const sdk = new Tearleads({
    logger: {
      log: () => undefined,
      logError: (_message, cause) => errors.push(cause),
    },
    online: true,
  });
  // Persisted session restores authToken before SQLite finishes booting.
  sdk.session.setContext({
    authToken: "restored-token",
    containerId: rootId,
    defaultOrganizationId: orgId,
    isAuthenticated: true,
    organizationId: orgId,
    userId: "user-1",
  });

  const preDbScope = sdk.domainScope;
  const preDbCoordinator = getOrCreateDomainSyncCoordinator(preDbScope);
  const { close, sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(sdk, ws);
  try {
    // Before SQLite boots, nothing is sent yet and the barrier stays armed.
    expect(sent).toEqual([]);
    expect(handle.awaitingInitialAcknowledgement()).toBe(true);
    expect(close).not.toHaveBeenCalled();

    // SQLite boots late and rotates domainScope from [null, ...] -> [dbId, ...].
    sdk.database.setExecSql(execSql, { id: "restored-db" });
    expect(preDbCoordinator.isDisposed()).toBe(true);
    expect(sdk.domainScope).not.toBe(preDbScope);
    // Socket stayed open and rebound in place instead of closing.
    expect(close).not.toHaveBeenCalled();

    // DeviceFirstProvider drives updateRuntime on the replacement scope once SQLite is ready.
    sdk.deviceFirst
      .open()
      .view.updateRuntime(sdk.containerContents.workflowRuntime());

    // The replacement scope hydrates from SQLite and declares the restored root.
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(sent[0] ?? "null")).toEqual({
      type: "known_containers",
      containerIds: [rootId],
      declarationId: expect.any(String),
    });
    expect(handle.awaitingInitialAcknowledgement()).toBe(true);
    acknowledgeInitialDeclaration(handle, sent);
    expect(handle.awaitingInitialAcknowledgement()).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    handle.stop();
    sdk.dispose();
    closeDb();
  }
});

test("logs container-interest open errors and triggers onRebindUnavailable if async rebind fails", () => {
  const logged: Array<{ message: string | Error; cause: unknown }> = [];
  const boom = new Error("store init failed");
  const sdk = {
    ...tearleadsWithStore(() => {
      throw boom;
    }),
    logError: (message: string | Error, cause?: unknown) => {
      logged.push({ message, cause });
    },
  } as unknown as Tearleads;

  const { ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(sdk, ws);
  expect(handle.awaitingInitialAcknowledgement()).toBe(false);
  expect(logged).toEqual([
    {
      message: "Failed to open container interest store for server events",
      cause: boom,
    },
  ]);

  // Now exercise async rebind failure: initial scope is not ready, replacement throws.
  const preReady = createFakeStore([]);
  preReady.setReady(false);
  let calls = 0;
  const realSdk = new Tearleads({
    logger: {
      log: () => undefined,
      logError: (message, cause) => logged.push({ message, cause }),
    },
  });
  const openSpy = realSdk.deviceFirst.open.bind(realSdk.deviceFirst);
  realSdk.deviceFirst.open = (() => {
    calls += 1;
    if (calls === 1) return { containerStore: preReady.store };
    throw boom;
  }) as unknown as typeof openSpy;

  let rebindUnavailable = 0;
  const { ws: ws2 } = fakeSocket(WebSocket.OPEN);
  const handle2 = startContainerInterestDeclaration(realSdk, ws2, {
    onRebindUnavailable: () => {
      rebindUnavailable += 1;
    },
  });
  try {
    expect(handle2.awaitingInitialAcknowledgement()).toBe(true);
    realSdk.database.configure({
      execSql: (async () => []) as never,
      id: "late-db",
    });
    expect(rebindUnavailable).toBe(1);
    expect(handle2.awaitingInitialAcknowledgement()).toBe(false);
  } finally {
    handle2.stop();
    realSdk.dispose();
  }
});

test("closes awaiting-tree socket on sign-in boundary and closes declared socket on scope rotation", () => {
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: () => undefined },
  });
  const preReady = createFakeStore([]);
  preReady.setReady(false);
  const openSpy = sdk.deviceFirst.open.bind(sdk.deviceFirst);
  let activeStore = preReady;
  sdk.deviceFirst.open = (() => ({
    containerStore: activeStore.store,
  })) as unknown as typeof openSpy;

  const first = fakeSocket(WebSocket.OPEN);
  sdk.session.setContext({ authToken: "session-1", isAuthenticated: true });
  const firstHandle = startContainerInterestDeclaration(sdk, first.ws);
  try {
    // Real session.logout() fails closed even when caller omits options.canRebind.
    sdk.session.logout();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(firstHandle.awaitingInitialAcknowledgement()).toBe(false);

    // After declaring and marking connected, rotating database.id closes the socket
    // and marks events disconnected even though domainScope changed.
    activeStore = createFakeStore(["root-1"]);
    const second = fakeSocket(WebSocket.OPEN);
    const secondHandle = startContainerInterestDeclaration(sdk, second.ws);
    try {
      acknowledgeInitialDeclaration(secondHandle, second.sent);
      sdk.events.setConnected(true);
      expect(sdk.events.connected).toBe(true);

      sdk.database.configure({
        execSql: (async () => []) as never,
        id: "db-2",
      });
      expect(second.close).toHaveBeenCalledTimes(1);
      expect(sdk.events.connected).toBe(false);
    } finally {
      secondHandle.stop();
    }
  } finally {
    firstHandle.stop();
    sdk.dispose();
  }
});
