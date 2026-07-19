import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  attachOrganizationReadModelSocket,
  ensureOrganizationReadModelReconciliation,
  handleOrganizationReadModelInterestAcknowledgement,
  subscribeOrganizationReadModelRealtime,
} from "./organizationReadModelRealtime";

const ORGANIZATION_ID = "00000000-0000-4000-8000-00000000000a";
const USER_ID = "00000000-0000-4000-8000-00000000001a";

function createRuntimeHarness(input?: {
  readonly loadDirectoryAndGroups?: () => Promise<unknown>;
  readonly loadDirectoryAndGroupsAfterMutation?: () => Promise<unknown>;
  readonly online?: boolean;
}) {
  const domainScope = {};
  let online = input?.online ?? true;
  let reconcileCalls = 0;
  const loadDirectoryAndGroups = async () => {
    reconcileCalls += 1;
    return input?.loadDirectoryAndGroups?.() ?? null;
  };
  const loadDirectoryAndGroupsAfterMutation = async () => {
    reconcileCalls += 1;
    return (
      input?.loadDirectoryAndGroupsAfterMutation?.() ??
      input?.loadDirectoryAndGroups?.() ??
      null
    );
  };
  const tearleads = {
    organizations: {
      loadDirectoryAndGroups,
      loadDirectoryAndGroupsAfterMutation,
    },
    runtime: {
      input: () => ({
        auth: {
          isAuthenticated: true,
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
        },
        infra: { dbStatus: "idle" },
        state: { domainScope, online },
      }),
    },
  } as unknown as Tearleads;

  return {
    get reconcileCalls() {
      return reconcileCalls;
    },
    setOnline(nextOnline: boolean) {
      online = nextOnline;
    },
    tearleads,
  };
}

function fakeOpenSocket() {
  const sent: string[] = [];
  return {
    sent,
    ws: {
      readyState: WebSocket.OPEN,
      send: (message: string) => sent.push(message),
    } as unknown as WebSocket,
  };
}

function acknowledgeLatestDeclaration(
  tearleads: Tearleads,
  socket: ReturnType<typeof fakeOpenSocket>,
): void {
  const declaration = JSON.parse(socket.sent.at(-1) ?? "null") as {
    declarationId?: unknown;
    organizationIds?: unknown;
  } | null;
  if (
    !declaration ||
    typeof declaration.declarationId !== "string" ||
    !Array.isArray(declaration.organizationIds)
  ) {
    throw new Error("Expected an organization interest declaration");
  }
  handleOrganizationReadModelInterestAcknowledgement(
    tearleads,
    socket.ws,
    declaration.declarationId,
    typeof declaration.organizationIds[0] === "string"
      ? declaration.organizationIds[0]
      : null,
    true,
  );
}

test("offline first demand stays local and reconciles once after resubscribe online", async () => {
  const runtime = createRuntimeHarness({ online: false });
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribeOffline = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_ID,
    () => undefined,
  );

  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(0);
  expect(socket.sent).toEqual([]);

  unsubscribeOffline();
  runtime.setOnline(true);
  const unsubscribeOnline = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_ID,
    () => undefined,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_ID,
  );

  expect(runtime.reconcileCalls).toBe(1);
  expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
    {
      type: "known_organizations",
      declarationId: "1",
      organizationIds: [ORGANIZATION_ID],
    },
  ]);

  unsubscribeOnline();
  detach();
});

test("prolonged realtime outage falls back to one HTTP reconciliation", async () => {
  const runtime = createRuntimeHarness();
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_ID,
    () => undefined,
  );

  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(1);

  unsubscribe();
});

test("disconnected fallback trails an in-flight connected snapshot", async () => {
  let releaseFirstRequest: (() => void) | undefined;
  let markFirstRequestStarted: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  const firstRequestStarted = new Promise<void>((resolve) => {
    markFirstRequestStarted = resolve;
  });
  let attempts = 0;
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => {
      attempts += 1;
      if (attempts === 1) {
        markFirstRequestStarted?.();
        return firstRequest;
      }
      return Promise.resolve(null);
    },
  });
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_ID,
    () => undefined,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  const catchUp = ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_ID,
  );
  await firstRequestStarted;

  detach();
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  expect(runtime.reconcileCalls).toBe(1);
  releaseFirstRequest?.();
  await catchUp;

  expect(runtime.reconcileCalls).toBe(2);
  unsubscribe();
});

test("reconnect trails a catch-up that started before interest declaration", async () => {
  let markRequestStarted: (() => void) | undefined;
  let releaseRequest: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const request = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => {
      markRequestStarted?.();
      return request;
    },
  });
  const firstSocket = fakeOpenSocket();
  const detachFirst = attachOrganizationReadModelSocket(
    runtime.tearleads,
    firstSocket.ws,
  );
  detachFirst();

  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_ID,
    () => undefined,
  );
  const catchUp = ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_ID,
  );
  await requestStarted;
  const secondSocket = fakeOpenSocket();
  const detachSecond = attachOrganizationReadModelSocket(
    runtime.tearleads,
    secondSocket.ws,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, secondSocket);
  releaseRequest?.();
  await catchUp;
  await Promise.resolve();

  expect(runtime.reconcileCalls).toBe(2);
  expect(secondSocket.sent.map((message) => JSON.parse(message))).toEqual([
    {
      type: "known_organizations",
      declarationId: "1",
      organizationIds: [ORGANIZATION_ID],
    },
  ]);

  detachSecond();
  unsubscribe();
});

test("reconnect catches up again after a disconnected pass completed", async () => {
  const runtime = createRuntimeHarness();
  const firstSocket = fakeOpenSocket();
  const detachFirst = attachOrganizationReadModelSocket(
    runtime.tearleads,
    firstSocket.ws,
  );
  detachFirst();

  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_ID,
    () => undefined,
  );
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_ID,
  );
  expect(runtime.reconcileCalls).toBe(1);

  const secondSocket = fakeOpenSocket();
  const detachSecond = attachOrganizationReadModelSocket(
    runtime.tearleads,
    secondSocket.ws,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, secondSocket);
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_ID,
  );

  expect(runtime.reconcileCalls).toBe(2);
  expect(secondSocket.sent.map((message) => JSON.parse(message))).toEqual([
    {
      type: "known_organizations",
      declarationId: "1",
      organizationIds: [ORGANIZATION_ID],
    },
  ]);

  detachSecond();
  unsubscribe();
});

test("post-declaration catch-up waits out SDK reconciliation begun while disconnected", async () => {
  let releaseDisconnectedRequest: (() => void) | undefined;
  const disconnectedRequest = new Promise<void>((resolve) => {
    releaseDisconnectedRequest = resolve;
  });
  let underlyingRequests = 0;
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => {
      underlyingRequests += 1;
      return disconnectedRequest;
    },
    loadDirectoryAndGroupsAfterMutation: async () => {
      await disconnectedRequest;
      underlyingRequests += 1;
      return null;
    },
  });
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_ID,
    () => undefined,
  );
  const disconnectedCatchUp =
    runtime.tearleads.organizations.loadDirectoryAndGroups();
  await Promise.resolve();
  expect(underlyingRequests).toBe(1);

  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  const declaredCatchUp = ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_ID,
  );
  await Promise.resolve();
  expect(underlyingRequests).toBe(1);

  releaseDisconnectedRequest?.();
  await Promise.all([disconnectedCatchUp, declaredCatchUp]);
  expect(underlyingRequests).toBe(2);
  expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
    {
      type: "known_organizations",
      declarationId: "1",
      organizationIds: [ORGANIZATION_ID],
    },
  ]);

  detach();
  unsubscribe();
});

test("reconnect retries a failed first-demand catch-up", async () => {
  let attempts = 0;
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("feed unavailable"))
        : Promise.resolve(null);
    },
  });
  const firstSocket = fakeOpenSocket();
  const detachFirst = attachOrganizationReadModelSocket(
    runtime.tearleads,
    firstSocket.ws,
  );
  detachFirst();

  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_ID,
    () => undefined,
  );
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_ID,
  );
  expect(runtime.reconcileCalls).toBe(1);

  const secondSocket = fakeOpenSocket();
  const detachSecond = attachOrganizationReadModelSocket(
    runtime.tearleads,
    secondSocket.ws,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, secondSocket);
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_ID,
  );

  expect(runtime.reconcileCalls).toBe(2);

  detachSecond();
  unsubscribe();
});
