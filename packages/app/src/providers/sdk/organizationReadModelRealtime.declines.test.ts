import { expect, test } from "bun:test";
import {
  attachOrganizationReadModelSocket,
  ensureOrganizationReadModelReconciliation,
  handleOrganizationReadModelHint,
  releaseDeferredOrganizationReadModelHint,
  subscribeOrganizationReadModelRealtime,
} from "./organizationReadModelRealtime";
import {
  acknowledgeLatestDeclaration,
  createRuntimeHarness,
  fakeOpenSocket,
  ORGANIZATION_A,
} from "./test/organizationReadModelRealtimeHarness";

test("a released deferred author hint reconciles the feed", async () => {
  const runtime = createRuntimeHarness();
  let mutating = false;
  let projectionUpdates = 0;
  subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => {
      projectionUpdates += 1;
    },
    {
      isMutationActive: () => mutating,
    },
  );

  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(runtime.reconcileCalls).toBe(1);
  expect(projectionUpdates).toBe(1);

  mutating = true;
  handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, true);
  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(1);

  // A session-scoped origin flag cannot prove the deferred change was this
  // client's own echo (a sibling client shares the login session), so the
  // release must reconcile the feed instead of repainting from local rows.
  mutating = false;
  releaseDeferredOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A);
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );

  expect(runtime.reconcileCalls).toBe(2);
  expect(projectionUpdates).toBe(2);
});

test("an authoritative null reconcile still repaints mounted consumers", async () => {
  // Null is a completed pass — an authoritative denial purged the durable
  // projection — so listeners must repaint the loss instead of holding
  // revoked rows on screen.
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => Promise.resolve(null),
  });
  let projectionUpdates = 0;
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => {
      projectionUpdates += 1;
    },
  );
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(runtime.reconcileCalls).toBe(1);
  expect(projectionUpdates).toBe(1);
  unsubscribe();
});

test("a declined pass clears a previously caught-up scope", async () => {
  let result: unknown = {};
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => Promise.resolve(result),
  });
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

  // A hint consumed by a declined pass (database temporarily not ready) means
  // the scope is no longer provably caught up.
  result = undefined;
  handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(runtime.reconcileCalls).toBe(2);

  result = {};
  unsubscribeFirst();
  const unsubscribeSecond = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(runtime.reconcileCalls).toBe(3);
  unsubscribeSecond();
  detach();
});

test("a declined reconcile does not mark the scope caught up", async () => {
  let result: unknown;
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => Promise.resolve(result),
  });
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

  // A warm same-task remount keeps the acknowledged lease. The declined pass
  // (e.g. database not yet ready) must not satisfy the remount's catch-up.
  result = {};
  unsubscribeFirst();
  const unsubscribeSecond = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(runtime.reconcileCalls).toBe(2);
  unsubscribeSecond();
  detach();
});
