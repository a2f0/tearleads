import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  attachOrganizationReadModelSocket,
  handleOrganizationReadModelHint,
  releaseDeferredOrganizationReadModelHint,
  scheduleOrganizationReadModelReconciliation,
  subscribeOrganizationReadModelRealtime,
} from "./organizationReadModelRealtime";
import { routeIncomingWsMessage } from "./serverEventsBinding";

const ORGANIZATION_A = "00000000-0000-4000-8000-00000000000a";
const ORGANIZATION_B = "00000000-0000-4000-8000-00000000000b";

function createRuntimeHarness(input?: {
  readonly loadDirectoryAndGroups?: () => Promise<unknown>;
}) {
  let auth = {
    isAuthenticated: true,
    organizationId: ORGANIZATION_A as string | null,
  };
  let containerCalls = 0;
  let documentCalls = 0;
  let reconcileCalls = 0;
  const tearleads = {
    containerContents: {
      openTree: () => {
        containerCalls += 1;
        throw new Error("organization hints must not open the container tree");
      },
    },
    deviceFirst: {
      reconciler: () => {
        documentCalls += 1;
        throw new Error("organization hints must not start document sync");
      },
    },
    organizations: {
      loadDirectoryAndGroups: async () => {
        reconcileCalls += 1;
        return input?.loadDirectoryAndGroups?.() ?? null;
      },
    },
    runtime: {
      input: () => ({ auth }),
    },
  } as unknown as Tearleads;

  return {
    get containerCalls() {
      return containerCalls;
    },
    get documentCalls() {
      return documentCalls;
    },
    get reconcileCalls() {
      return reconcileCalls;
    },
    setOrganizationId(organizationId: string | null) {
      auth = { ...auth, organizationId };
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

function parsedMessages(messages: readonly string[]) {
  return messages.map((message) => JSON.parse(message));
}

test("declares organization interest only while a consumer has demand", async () => {
  const runtime = createRuntimeHarness();
  const { sent, ws } = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(runtime.tearleads, ws);

  handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, false);
  await Promise.resolve();
  expect(sent).toEqual([]);
  expect(runtime.reconcileCalls).toBe(0);

  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  expect(parsedMessages(sent)).toEqual([
    { type: "known_organizations", organizationIds: [ORGANIZATION_A] },
  ]);

  unsubscribe();
  expect(parsedMessages(sent)).toEqual([
    { type: "known_organizations", organizationIds: [ORGANIZATION_A] },
    { type: "known_organizations", organizationIds: [] },
  ]);
  detach();
});

test("routes valid organization controls outside the domain event queue", () => {
  const organizationHints: string[] = [];
  const genericEvents: unknown[] = [];
  for (const type of [
    "organization_read_model_changed",
    "organization_read_model_access_revoked",
  ]) {
    routeIncomingWsMessage(
      JSON.stringify({
        type,
        organizationId: ORGANIZATION_A,
        ...(type === "organization_read_model_changed"
          ? { originatedFromSession: false }
          : {}),
      }),
      {
        onInterestState: () => undefined,
        onOrganizationReadModelChanged: (organizationId) =>
          organizationHints.push(organizationId),
        onResyncRequired: () => undefined,
        onServerEvent: (event) => genericEvents.push(event),
        onSharedWithYou: () => undefined,
      },
    );
  }

  expect(organizationHints).toEqual([ORGANIZATION_A, ORGANIZATION_A]);
  expect(genericEvents).toEqual([]);
});

test("drops malformed read-model controls instead of entering domain sync", () => {
  let organizationHints = 0;
  let genericEvents = 0;
  routeIncomingWsMessage(
    JSON.stringify({
      type: "organization_read_model_changed",
      organizationId: "not-an-organization-id",
    }),
    {
      onInterestState: () => undefined,
      onOrganizationReadModelChanged: () => {
        organizationHints += 1;
      },
      onResyncRequired: () => undefined,
      onServerEvent: () => {
        genericEvents += 1;
      },
      onSharedWithYou: () => undefined,
    },
  );

  expect(organizationHints).toBe(0);
  expect(genericEvents).toBe(0);
});

test("coalesces a websocket burst and performs one trailing in-flight pass", async () => {
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let underlyingCalls = 0;
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => {
      underlyingCalls += 1;
      if (underlyingCalls === 1) {
        markFirstStarted?.();
        return first;
      }
      return Promise.resolve(null);
    },
  });
  let projectionUpdates = 0;
  subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => {
      projectionUpdates += 1;
    },
  );

  const active = scheduleOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  const sameBurst = scheduleOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(active).toBe(sameBurst);
  await firstStarted;
  expect(runtime.reconcileCalls).toBe(1);

  const duringRequest = scheduleOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(duringRequest).toBe(active);
  releaseFirst?.();
  await active;

  expect(runtime.reconcileCalls).toBe(2);
  expect(projectionUpdates).toBe(2);
  expect(runtime.containerCalls).toBe(0);
  expect(runtime.documentCalls).toBe(0);
});

test("an explicit mutation reconcile absorbs deferred author echoes", async () => {
  const runtime = createRuntimeHarness();
  let cursor: string | null = "cursor-before";
  let mutating = true;
  let projectionUpdates = 0;
  subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => {
      projectionUpdates += 1;
    },
    {
      getReadModelCursor: () => cursor,
      isMutationActive: () => mutating,
    },
  );

  handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, true);
  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(0);

  cursor = "cursor-after";
  mutating = false;
  releaseDeferredOrganizationReadModelHint(
    runtime.tearleads,
    ORGANIZATION_A,
    cursor,
  );
  await Promise.resolve();

  expect(runtime.reconcileCalls).toBe(0);
  expect(projectionUpdates).toBe(1);
});

test("ignores undemanded scope and catches up demanded scope on reconnect", async () => {
  const runtime = createRuntimeHarness();
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  const firstSocket = fakeOpenSocket();
  const detachFirst = attachOrganizationReadModelSocket(
    runtime.tearleads,
    firstSocket.ws,
  );

  await scheduleOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_B,
  );
  expect(runtime.reconcileCalls).toBe(0);

  detachFirst();
  const secondSocket = fakeOpenSocket();
  const detachSecond = attachOrganizationReadModelSocket(
    runtime.tearleads,
    secondSocket.ws,
  );
  await Promise.resolve();
  await Promise.resolve();

  expect(parsedMessages(firstSocket.sent)).toEqual([
    { type: "known_organizations", organizationIds: [ORGANIZATION_A] },
  ]);
  expect(parsedMessages(secondSocket.sent)).toEqual([
    { type: "known_organizations", organizationIds: [ORGANIZATION_A] },
  ]);
  expect(runtime.reconcileCalls).toBe(1);

  detachSecond();
  unsubscribe();
});
