import { expect, test } from "bun:test";
import { waitForAppTestRuntimeToSettle } from "../../../test/helpers/appRuntimeIdle";
import { observeOrganizationRuntime } from "../../../test/helpers/organizationRuntimeIdle";
import {
  attachOrganizationReadModelSocket,
  ensureOrganizationReadModelReconciliation,
  handleOrganizationReadModelHint,
  subscribeOrganizationReadModelRealtime,
} from "./organizationReadModelRealtime";
import {
  acknowledgeLatestDeclaration,
  createRuntimeHarness,
  fakeOpenSocket,
  ORGANIZATION_A,
} from "./test/organizationReadModelRealtimeHarness";

test("runtime idle waits for organization interest acknowledgement", async () => {
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const stopObserving = observeOrganizationRuntime(runtime.tearleads);
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  try {
    expect(runtime.reconcileCalls).toBe(0);
    expect(await waitForAppTestRuntimeToSettle({ timeoutMs: 80 })).toBe(false);
    acknowledgeLatestDeclaration(runtime.tearleads, socket);
    await ensureOrganizationReadModelReconciliation(
      runtime.tearleads,
      ORGANIZATION_A,
    );
    expect(await waitForAppTestRuntimeToSettle()).toBe(true);
    expect(runtime.reconcileCalls).toBe(1);
  } finally {
    unsubscribe();
    detach();
    stopObserving();
  }
});

test("runtime idle waits for local projection work and its queued feed pass", async () => {
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const stopObserving = observeOrganizationRuntime(runtime.tearleads);
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  const active = ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  try {
    await entered.promise;
    handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, false);
    expect(runtime.reconcileCalls).toBe(1);
    expect(await waitForAppTestRuntimeToSettle({ timeoutMs: 80 })).toBe(false);
    release.resolve();
    await active;
    expect(await waitForAppTestRuntimeToSettle()).toBe(true);
    expect(runtime.reconcileCalls).toBe(2);
  } finally {
    release.resolve();
    await active;
    unsubscribe();
    detach();
    stopObserving();
  }
});
