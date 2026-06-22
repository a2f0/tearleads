import { expect, test } from "bun:test";
import { type WsConnection, WsEventRouter } from "./wsRouting";

interface FakeSocket extends WsConnection {
  readonly sent: string[];
}

function fakeSocket(
  userId: string,
  sessionId = `${userId}-session`,
): FakeSocket {
  const sent: string[] = [];
  return {
    data: { sessionId, userId },
    sent,
    send(message: string) {
      sent.push(message);
      return undefined;
    },
  };
}

function documentEvent(containerIds: string[], documentId = "doc-1"): string {
  return JSON.stringify({
    type: "document_update_created",
    containerIds,
    documentId,
    updateIds: ["update-1"],
  });
}

test("delivers a document event only to sockets interested in its containers", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  const bob = fakeSocket("bob");
  router.open(alice);
  router.open(bob);

  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers", containerIds: ["c1", "c2"] }),
  );
  router.handleClientMessage(
    bob,
    JSON.stringify({ type: "known_containers", containerIds: ["c2"] }),
  );

  const event = documentEvent(["c1"]);
  router.routeServerEvent(event);

  // Only alice declared interest in c1.
  expect(alice.sent).toEqual([event]);
  expect(bob.sent).toEqual([]);
});

test("delivers a shared-container event to every interested socket once", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  const bob = fakeSocket("bob");
  router.open(alice);
  router.open(bob);
  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers", containerIds: ["shared"] }),
  );
  router.handleClientMessage(
    bob,
    JSON.stringify({ type: "known_containers", containerIds: ["shared"] }),
  );

  // Two containers on the event, both mapping to the same socket -> one send.
  const event = documentEvent(["shared", "shared"]);
  router.routeServerEvent(event);

  expect(alice.sent).toEqual([event]);
  expect(bob.sent).toEqual([event]);
});

test("routes container events by container, parent, and previous parent", () => {
  const router = new WsEventRouter();
  const parentWatcher = fakeSocket("parent-watcher");
  router.open(parentWatcher);
  router.handleClientMessage(
    parentWatcher,
    JSON.stringify({ type: "known_containers", containerIds: ["parent"] }),
  );

  const event = JSON.stringify({
    type: "container_mutation_created",
    containerId: "child",
    eventType: "container.create",
    parentId: "parent",
    updatedAt: "2026-06-22T00:00:00.000Z",
  });
  router.routeServerEvent(event);

  // The parent's watcher learns a child changed even without declaring the child.
  expect(parentWatcher.sent).toEqual([event]);
});

test("routes scopeless user events to that user's sockets only", () => {
  const router = new WsEventRouter();
  const aliceA = fakeSocket("alice", "alice-a");
  const aliceB = fakeSocket("alice", "alice-b");
  const bob = fakeSocket("bob");
  router.open(aliceA);
  router.open(aliceB);
  router.open(bob);

  const event = JSON.stringify({
    type: "user_registered",
    userId: "alice",
    fingerprint: "fp",
  });
  router.routeServerEvent(event);

  expect(aliceA.sent).toEqual([event]);
  expect(aliceB.sent).toEqual([event]);
  expect(bob.sent).toEqual([]);
});

test("applies interest add/remove deltas", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);

  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers.add", containerIds: ["c1"] }),
  );
  router.routeServerEvent(documentEvent(["c1"]));
  expect(alice.sent).toHaveLength(1);

  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers.remove", containerIds: ["c1"] }),
  );
  router.routeServerEvent(documentEvent(["c1"]));
  // No new delivery after the container was dropped from interest.
  expect(alice.sent).toHaveLength(1);
  expect(router.interestedSocketCount("c1")).toBe(0);
});

test("drops a closed socket from all routing", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);
  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers", containerIds: ["c1"] }),
  );

  router.close(alice);
  router.routeServerEvent(documentEvent(["c1"]));

  expect(alice.sent).toEqual([]);
  expect(router.interestedSocketCount("c1")).toBe(0);
});

test("reports the applied interest change back to the caller", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);

  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({ type: "known_containers", containerIds: ["c1"] }),
    ),
  ).toEqual({ kind: "replace", containerIds: ["c1"] });
  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({ type: "known_containers.add", containerIds: ["c2"] }),
    ),
  ).toEqual({ kind: "add", containerIds: ["c2"] });
  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({ type: "known_containers.remove", containerIds: ["c1"] }),
    ),
  ).toEqual({ kind: "remove", containerIds: ["c1"] });
  expect(router.handleClientMessage(alice, "not json")).toBeNull();
  expect(
    router.handleClientMessage(alice, JSON.stringify({ type: "other" })),
  ).toBeNull();
});

test("hydrateInterest seeds a reconnecting socket's interest", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);

  // Reconnect: the server restores interest from its persisted set, no client
  // re-declaration needed.
  router.hydrateInterest(alice, ["c1", "c2"]);
  router.routeServerEvent(documentEvent(["c2"]));

  expect(alice.sent).toHaveLength(1);
  expect(router.interestedSocketCount("c1")).toBe(1);
  expect(router.interestedSocketCount("c2")).toBe(1);
});

test("access_changed evicts interest and tells interested sockets to resync", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  const bob = fakeSocket("bob");
  router.open(alice);
  router.open(bob);
  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers", containerIds: ["x", "y"] }),
  );
  router.handleClientMessage(
    bob,
    JSON.stringify({ type: "known_containers", containerIds: ["x"] }),
  );

  const evictions = router.routeServerEvent(
    JSON.stringify({ type: "access_changed", containerId: "x" }),
  );

  const resync = JSON.stringify({ containerId: "x", type: "resync_required" });
  // Both sockets interested in x are told to resync, and x is dropped from
  // their interest so no further x events reach them until they re-declare.
  expect(alice.sent).toEqual([resync]);
  expect(bob.sent).toEqual([resync]);
  expect(router.interestedSocketCount("x")).toBe(0);
  // Unaffected interest (y) is untouched.
  expect(router.interestedSocketCount("y")).toBe(1);
  // The evictions are returned so the shell drops them from the persisted set,
  // or a reconnect would restore the just-revoked interest.
  expect(evictions).toEqual([
    { containerId: "x", sessionId: "alice-session", userId: "alice" },
    { containerId: "x", sessionId: "bob-session", userId: "bob" },
  ]);

  router.routeServerEvent(documentEvent(["x"]));
  // No document delivery after eviction.
  expect(alice.sent).toEqual([resync]);
});

test("ignores malformed client messages and unscoped events", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);
  router.handleClientMessage(alice, "not json");
  router.handleClientMessage(alice, JSON.stringify({ type: "unknown" }));
  router.routeServerEvent("not json");
  router.routeServerEvent(JSON.stringify({ type: "mystery" }));

  expect(alice.sent).toEqual([]);
});
