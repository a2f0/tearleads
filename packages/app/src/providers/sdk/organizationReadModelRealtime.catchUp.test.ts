import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  attachOrganizationReadModelSocket,
  subscribeOrganizationReadModelRealtime,
} from "./organizationReadModelRealtime";
import {
  acknowledgeLatestDeclaration,
  createRuntimeHarness,
  fakeOpenSocket,
  ORGANIZATION_A,
  settleReconciliation,
} from "./test/organizationReadModelRealtimeHarness";

function subscribeRecording(tearleads: Tearleads, events: string[]) {
  return subscribeOrganizationReadModelRealtime(
    tearleads,
    ORGANIZATION_A,
    () => {
      events.push("repaint");
    },
    {
      onCatchUpSettled: () => {
        events.push("settled");
      },
    },
  );
}

test("a catch-up settles only after its reconciled pass repainted the consumer", async () => {
  // A consumer that reads "settled" as "the projection is final" must never
  // see it before the repaint, or it flashes an empty state over a roster
  // that is about to land.
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const events: string[] = [];
  const unsubscribe = subscribeRecording(runtime.tearleads, events);

  await settleReconciliation(runtime.tearleads);
  expect(events).toEqual([]);

  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  await settleReconciliation(runtime.tearleads);

  expect(runtime.reconcileCalls).toBe(1);
  expect(events).toEqual(["repaint", "settled"]);
  unsubscribe();
  detach();
});

test("a declined catch-up settles without repainting", async () => {
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => Promise.resolve(undefined),
  });
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const events: string[] = [];
  const unsubscribe = subscribeRecording(runtime.tearleads, events);

  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  await settleReconciliation(runtime.tearleads);

  expect(runtime.reconcileCalls).toBe(1);
  expect(events).toEqual(["settled"]);
  unsubscribe();
  detach();
});

test("a consumer joining a caught-up scope settles at once without a read", async () => {
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribeOwner = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  await settleReconciliation(runtime.tearleads);

  const events: string[] = [];
  const unsubscribeJoining = subscribeRecording(runtime.tearleads, events);

  expect(events).toEqual(["settled"]);
  await settleReconciliation(runtime.tearleads);
  expect(runtime.reconcileCalls).toBe(1);
  unsubscribeJoining();
  unsubscribeOwner();
  detach();
});
