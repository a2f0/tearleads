import { expect, test } from "bun:test";
import {
  attachOrganizationReadModelSocket,
  ensureOrganizationReadModelReconciliation,
  handleOrganizationReadModelHint,
  handleOrganizationReadModelInterestAcknowledgement,
  subscribeOrganizationReadModelRealtime,
} from "./organizationReadModelRealtime";
import { routeIncomingWsMessage } from "./serverEventsBinding";
import {
  acknowledgeLatestDeclaration,
  createRuntimeHarness,
  fakeOpenSocket,
  ORGANIZATION_A,
  parsedMessages,
} from "./test/organizationReadModelRealtimeHarness";

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
    {
      type: "known_organizations",
      declarationId: "1",
      organizationIds: [ORGANIZATION_A],
    },
  ]);

  unsubscribe();
  await Promise.resolve();
  expect(parsedMessages(sent)).toEqual([
    {
      type: "known_organizations",
      declarationId: "1",
      organizationIds: [ORGANIZATION_A],
    },
    { type: "known_organizations", declarationId: "2", organizationIds: [] },
  ]);
  detach();
});

test("routes valid organization controls outside the domain event queue", () => {
  const acknowledgements: Array<[string, string | null, boolean]> = [];
  const organizationHints: string[] = [];
  const genericEvents: unknown[] = [];
  routeIncomingWsMessage(
    JSON.stringify({
      type: "known_organizations_ack",
      authorized: true,
      declarationId: "declaration-1",
      organizationId: ORGANIZATION_A,
    }),
    {
      onContainerInterestAcknowledged: () => undefined,
      onInterestState: () => undefined,
      onOrganizationInterestAcknowledged: (...acknowledgement) =>
        acknowledgements.push(acknowledgement),
      onOrganizationReadModelChanged: () => undefined,
      onResyncRequired: () => undefined,
      onServerEvent: (event) => genericEvents.push(event),
      onSharedWithYou: () => undefined,
    },
  );
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
        onContainerInterestAcknowledged: () => undefined,
        onInterestState: () => undefined,
        onOrganizationInterestAcknowledged: () => undefined,
        onOrganizationReadModelChanged: (organizationId) =>
          organizationHints.push(organizationId),
        onResyncRequired: () => undefined,
        onServerEvent: (event) => genericEvents.push(event),
        onSharedWithYou: () => undefined,
      },
    );
  }

  expect(acknowledgements).toEqual([["declaration-1", ORGANIZATION_A, true]]);
  expect(organizationHints).toEqual([ORGANIZATION_A, ORGANIZATION_A]);
  expect(genericEvents).toEqual([]);
});

test("drops malformed read-model controls instead of entering domain sync", () => {
  let acknowledgements = 0;
  let organizationHints = 0;
  let genericEvents = 0;
  const handlers = {
    onContainerInterestAcknowledged: () => undefined,
    onInterestState: () => undefined,
    onOrganizationInterestAcknowledged: () => {
      acknowledgements += 1;
    },
    onOrganizationReadModelChanged: () => {
      organizationHints += 1;
    },
    onResyncRequired: () => undefined,
    onServerEvent: () => {
      genericEvents += 1;
    },
    onSharedWithYou: () => undefined,
  };
  routeIncomingWsMessage(
    JSON.stringify({
      type: "organization_read_model_changed",
      organizationId: "not-an-organization-id",
    }),
    handlers,
  );
  for (const malformedAcknowledgement of [
    {
      type: "known_organizations_ack",
      authorized: true,
      declarationId: "x".repeat(129),
      organizationId: ORGANIZATION_A,
    },
    {
      type: "known_organizations_ack",
      authorized: "true",
      declarationId: "declaration-1",
      organizationId: ORGANIZATION_A,
    },
    {
      type: "known_organizations_ack",
      authorized: false,
      declarationId: "declaration-1",
      organizationId: "not-an-organization-id",
    },
  ]) {
    routeIncomingWsMessage(JSON.stringify(malformedAcknowledgement), handlers);
  }

  expect(acknowledgements).toBe(0);
  expect(organizationHints).toBe(0);
  expect(genericEvents).toBe(0);
});

test("reconciliation waits for the matching organization declaration acknowledgement", async () => {
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(0);

  handleOrganizationReadModelInterestAcknowledgement(
    runtime.tearleads,
    socket.ws,
    "stale-declaration",
    ORGANIZATION_A,
    false,
  );
  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(0);

  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(runtime.reconcileCalls).toBe(1);

  unsubscribe();
  detach();
});

test("denied declaration acknowledgement drives authoritative purge reconciliation", async () => {
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );

  acknowledgeLatestDeclaration(runtime.tearleads, socket, false);
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );

  expect(runtime.reconcileCalls).toBe(1);
  unsubscribe();
  detach();
});

test("same-task zero-demand cleanup does not start reconciliation", async () => {
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  unsubscribe();
  await Promise.resolve();
  await Promise.resolve();

  expect(runtime.reconcileCalls).toBe(0);
  detach();
});

test("same-task warm route remount retains one catch-up", async () => {
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribeFirst = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(runtime.reconcileCalls).toBe(1);

  unsubscribeFirst();
  const unsubscribeRemount = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(1);

  unsubscribeRemount();
  detach();
});
