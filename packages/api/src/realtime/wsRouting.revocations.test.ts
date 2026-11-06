import { expect, test } from "bun:test";
import {
  applyContainerInterest,
  C1,
  documentEvent,
  fakeSocket,
} from "../../test/helpers/wsRouting";
import { WsEventRouter } from "./wsRouting";

const X = "00000000-0000-4000-8000-000000000008";
const Y = "00000000-0000-4000-8000-000000000009";

test("access_changed evicts interest and tells interested sockets to resync", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  const bob = fakeSocket("bob");
  router.open(alice);
  router.open(bob);
  applyContainerInterest(
    router,
    alice,
    JSON.stringify({ type: "known_containers", containerIds: [X, Y] }),
  );
  applyContainerInterest(
    router,
    bob,
    JSON.stringify({ type: "known_containers", containerIds: [X] }),
  );

  router.routeServerEvent(
    JSON.stringify({ type: "access_changed", containerId: X }),
  );

  const resync = JSON.stringify({ containerIds: [X], type: "resync_required" });
  // Y has an independent verified path and keeps its subscription.
  expect(alice.sent).toEqual([resync]);
  expect(bob.sent).toEqual([resync]);
  expect(router.interestedSocketCount(X)).toBe(0);
  expect(router.interestedSocketCount(Y)).toBe(1);

  router.routeServerEvent(documentEvent([X]));
  // No document delivery after eviction.
  expect(alice.sent).toEqual([resync]);
});

test("session_revoked closes only sockets for that session", () => {
  const router = new WsEventRouter();
  const aliceA = fakeSocket("alice", "alice-a");
  const aliceB = fakeSocket("alice", "alice-b");
  const bob = fakeSocket("bob", "alice-a");
  router.open(aliceA);
  router.open(aliceB);
  router.open(bob);
  applyContainerInterest(
    router,
    aliceA,
    JSON.stringify({ type: "known_containers", containerIds: [C1] }),
  );

  router.routeServerEvent(
    JSON.stringify({
      type: "session_revoked",
      userId: "alice",
      sessionId: "alice-a",
    }),
  );

  expect(aliceA.closed).toEqual([{ code: 1008, reason: "Session revoked" }]);
  expect(aliceB.closed).toEqual([]);
  expect(bob.closed).toEqual([]);
  expect(router.interestedSocketCount(C1)).toBe(0);

  router.routeServerEvent(documentEvent([C1]));
  expect(aliceA.sent).toEqual([]);
});
