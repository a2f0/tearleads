import { expect, test } from "bun:test";
import {
  attachOrganizationReadModelSocket,
  ensureOrganizationReadModelReconciliation,
  handleOrganizationReadModelHint,
  releaseHeldOrganizationReadModelHint,
  subscribeOrganizationReadModelRealtime,
} from "./organizationReadModelRealtime";
import {
  acknowledgeLatestDeclaration,
  createRuntimeHarness,
  fakeOpenSocket,
  ORGANIZATION_A,
  readModelCursor,
  settleReconciliation,
} from "./test/organizationReadModelRealtimeHarness";

test("a hint held during a mutation reads only if ahead of the applied cursor", async () => {
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
  handleOrganizationReadModelHint(
    runtime.tearleads,
    ORGANIZATION_A,
    readModelCursor(6),
  );
  await settleReconciliation(runtime.tearleads);
  expect(runtime.reconcileCalls).toBe(1);

  // The mutation's own post-commit read applied the hinted cursor.
  runtime.setAppliedCursor(readModelCursor(6));
  mutating = false;
  releaseHeldOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A);
  await settleReconciliation(runtime.tearleads);
  expect(runtime.reconcileCalls).toBe(1);
  expect(projectionUpdates).toBe(2);

  // A later change (a sibling client or another member) is still read.
  handleOrganizationReadModelHint(
    runtime.tearleads,
    ORGANIZATION_A,
    readModelCursor(7),
  );
  await settleReconciliation(runtime.tearleads);
  expect(runtime.reconcileCalls).toBe(2);
  expect(projectionUpdates).toBe(3);
});

test("hints during an in-flight read run one follow-up only if still ahead", async () => {
  let started = Promise.withResolvers<void>();
  const reads: PromiseWithResolvers<string>[] = [];
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: async () => {
      const read = Promise.withResolvers<string>();
      reads.push(read);
      started.resolve();
      runtime.setAppliedCursor(await read.promise);
      return {};
    },
  });
  subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  const hint = (position: number) =>
    handleOrganizationReadModelHint(
      runtime.tearleads,
      ORGANIZATION_A,
      readModelCursor(position),
    );

  hint(2);
  await started.promise;
  hint(3);
  hint(5);
  reads[0]?.resolve(readModelCursor(5));
  await settleReconciliation(runtime.tearleads);
  // The returned cursor covers the highest pending hint: no follow-up.
  expect(runtime.reconcileCalls).toBe(1);

  started = Promise.withResolvers<void>();
  hint(6);
  await started.promise;
  hint(7);
  hint(8);
  started = Promise.withResolvers<void>();
  reads[1]?.resolve(readModelCursor(6));
  await started.promise;
  reads[2]?.resolve(readModelCursor(8));
  await settleReconciliation(runtime.tearleads);
  // The returned cursor is behind the pending maximum: exactly one follow-up.
  expect(runtime.reconcileCalls).toBe(3);
});

test("a hint whose cursor cannot be compared reads", async () => {
  const runtime = createRuntimeHarness();
  runtime.setAppliedCursor(readModelCursor(9));
  subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  handleOrganizationReadModelHint(
    runtime.tearleads,
    ORGANIZATION_A,
    readModelCursor(1, "00000000-0000-4000-8000-00000000000b"),
  );
  await settleReconciliation(runtime.tearleads);
  expect(runtime.reconcileCalls).toBe(1);
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
  handleOrganizationReadModelHint(
    runtime.tearleads,
    ORGANIZATION_A,
    readModelCursor(1),
  );
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
