import { expect, test } from "bun:test";
import { type WsConnection, WsEventRouter } from "./wsRouting";

const C1 = "00000000-0000-4000-8000-000000000001";
const C2 = "00000000-0000-4000-8000-000000000002";
const CHILD = "00000000-0000-4000-8000-000000000003";
const LIVE = "00000000-0000-4000-8000-000000000004";
const PARENT = "00000000-0000-4000-8000-000000000005";
const PERSISTED = "00000000-0000-4000-8000-000000000006";
const SHARED = "00000000-0000-4000-8000-000000000007";
const X = "00000000-0000-4000-8000-000000000008";
const Y = "00000000-0000-4000-8000-000000000009";

interface FakeSocket extends WsConnection {
  readonly closed: Array<{
    code: number | undefined;
    reason: string | undefined;
  }>;
  readonly sent: string[];
}

function fakeSocket(
  userId: string,
  sessionId = `${userId}-session`,
): FakeSocket {
  const closed: FakeSocket["closed"] = [];
  const sent: string[] = [];
  return {
    data: { sessionId, userId },
    closed,
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
    },
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
    JSON.stringify({ type: "known_containers", containerIds: [C1, C2] }),
  );
  router.handleClientMessage(
    bob,
    JSON.stringify({ type: "known_containers", containerIds: [C2] }),
  );

  const event = documentEvent([C1]);
  router.routeServerEvent(event);

  // Only alice declared interest in c1.
  expect(alice.sent).toEqual([event]);
  expect(bob.sent).toEqual([]);
});

test("excludes the authoring session's own socket from its update echo", () => {
  const router = new WsEventRouter();
  // Two sessions of the same user, both interested in c1.
  const authorTab = fakeSocket("alice", "alice-tab-a");
  const otherTab = fakeSocket("alice", "alice-tab-b");
  router.open(authorTab);
  router.open(otherTab);
  router.handleClientMessage(
    authorTab,
    JSON.stringify({ type: "known_containers", containerIds: [C1] }),
  );
  router.handleClientMessage(
    otherTab,
    JSON.stringify({ type: "known_containers", containerIds: [C1] }),
  );

  router.routeServerEvent(
    JSON.stringify({
      type: "document_update_created",
      containerIds: [C1],
      documentId: "doc-1",
      updateIds: ["update-1"],
      origin: { sessionId: "alice-tab-a", userId: "alice" },
    }),
  );

  // The authoring socket gets nothing back; its other tab still syncs.
  expect(authorTab.sent).toEqual([]);
  expect(otherTab.sent).toHaveLength(1);
});

test("strips origin from the payload forwarded to clients", () => {
  const router = new WsEventRouter();
  const reader = fakeSocket("bob");
  router.open(reader);
  router.handleClientMessage(
    reader,
    JSON.stringify({ type: "known_containers", containerIds: [C1] }),
  );

  router.routeServerEvent(
    JSON.stringify({
      type: "document_update_created",
      containerIds: [C1],
      documentId: "doc-1",
      updateIds: ["update-1"],
      origin: { sessionId: "alice-tab-a", userId: "alice" },
    }),
  );

  // The reader is not the author, so it receives the event — but the internal
  // origin (and its sensitive sessionId) is stripped before it goes out. The
  // router re-serializes the remaining fields in their original order, so the
  // forwarded payload is exactly the event minus `origin`.
  expect(reader.sent).toEqual([
    JSON.stringify({
      type: "document_update_created",
      containerIds: [C1],
      documentId: "doc-1",
      updateIds: ["update-1"],
    }),
  ]);
});

test("drops an event with a malformed origin to prevent session id leaks", () => {
  const router = new WsEventRouter();
  const reader = fakeSocket("bob");
  router.open(reader);
  router.handleClientMessage(
    reader,
    JSON.stringify({ type: "known_containers", containerIds: [C1] }),
  );

  // A partial origin (sessionId present, userId missing) is not a valid
  // identity. The published-event schema fails closed on it, so the event is
  // not delivered at all — and the sensitive sessionId in the payload can
  // never reach a client.
  router.routeServerEvent(
    JSON.stringify({
      type: "document_update_created",
      containerIds: [C1],
      documentId: "doc-1",
      updateIds: ["update-1"],
      origin: { sessionId: "sensitive-session-id" },
    }),
  );

  expect(reader.sent).toEqual([]);
});

test("delivers to every interested socket when no origin is tagged", () => {
  const router = new WsEventRouter();
  // An untagged event (e.g. attachment-bind, or pre-origin events) excludes
  // nobody — the author's own socket included — preserving prior behavior.
  const author = fakeSocket("alice");
  router.open(author);
  router.handleClientMessage(
    author,
    JSON.stringify({ type: "known_containers", containerIds: [C1] }),
  );

  const event = documentEvent([C1]);
  router.routeServerEvent(event);

  expect(author.sent).toEqual([event]);
});

test("delivers a shared-container event to every interested socket once", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  const bob = fakeSocket("bob");
  router.open(alice);
  router.open(bob);
  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers", containerIds: [SHARED] }),
  );
  router.handleClientMessage(
    bob,
    JSON.stringify({ type: "known_containers", containerIds: [SHARED] }),
  );

  // Two containers on the event, both mapping to the same socket -> one send.
  const event = documentEvent([SHARED, SHARED]);
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
    JSON.stringify({ type: "known_containers", containerIds: [PARENT] }),
  );

  const event = JSON.stringify({
    type: "container_mutation_created",
    containerId: CHILD,
    eventType: "container.create",
    parentId: PARENT,
    updatedAt: "2026-06-22T00:00:00.000Z",
  });
  router.routeServerEvent(event);

  // The parent's watcher learns a child changed even without declaring the child.
  expect(parentWatcher.sent).toEqual([event]);
});

test("delivers an origin-tagged container create to the author's other session, not the author", () => {
  const router = new WsEventRouter();
  const authorTab = fakeSocket("alice", "alice-a");
  const recoveredPeer = fakeSocket("alice", "alice-b");
  router.open(authorTab);
  router.open(recoveredPeer);
  // Both sessions of the same identity already know the parent (root) container.
  for (const ws of [authorTab, recoveredPeer]) {
    router.handleClientMessage(
      ws,
      JSON.stringify({ type: "known_containers", containerIds: [PARENT] }),
    );
  }

  router.routeServerEvent(
    JSON.stringify({
      type: "container_mutation_created",
      containerId: CHILD,
      eventType: "container.create",
      parentId: PARENT,
      updatedAt: "2026-06-22T00:00:00.000Z",
      origin: { sessionId: "alice-a", userId: "alice" },
    }),
  );

  // The authoring tab does not receive its own create echoed back...
  expect(authorTab.sent).toEqual([]);
  // ...but the same identity's other peer does (origin stripped), so it re-lists
  // the parent and surfaces the new folder — the cross-peer folder-sync path.
  expect(recoveredPeer.sent).toEqual([
    JSON.stringify({
      type: "container_mutation_created",
      containerId: CHILD,
      eventType: "container.create",
      parentId: PARENT,
      updatedAt: "2026-06-22T00:00:00.000Z",
    }),
  ]);
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

test("routes a user-scoped discovery hint to the author's other session", () => {
  const router = new WsEventRouter();
  const author = fakeSocket("alice", "alice-a");
  const otherSession = fakeSocket("alice", "alice-b");
  const bob = fakeSocket("bob");
  router.open(author);
  router.open(otherSession);
  router.open(bob);

  router.routeServerEvent(
    JSON.stringify({
      type: "shared_with_you",
      userId: "alice",
      origin: { sessionId: "alice-a", userId: "alice" },
    }),
  );

  expect(author.sent).toEqual([]);
  expect(otherSession.sent).toEqual([
    JSON.stringify({ type: "shared_with_you", userId: "alice" }),
  ]);
  expect(bob.sent).toEqual([]);
});

test("applies interest add/remove deltas", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);

  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers.add", containerIds: [C1] }),
  );
  router.routeServerEvent(documentEvent([C1]));
  expect(alice.sent).toHaveLength(1);

  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers.remove", containerIds: [C1] }),
  );
  router.routeServerEvent(documentEvent([C1]));
  // No new delivery after the container was dropped from interest.
  expect(alice.sent).toHaveLength(1);
  expect(router.interestedSocketCount(C1)).toBe(0);
});

test("drops a closed socket from all routing", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);
  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers", containerIds: [C1] }),
  );

  router.close(alice);
  router.routeServerEvent(documentEvent([C1]));

  expect(alice.sent).toEqual([]);
  expect(router.interestedSocketCount(C1)).toBe(0);
});

test("reports the applied interest change back to the caller", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);

  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({ type: "known_containers", containerIds: [C1] }),
    ),
  ).toEqual({ kind: "replace", containerIds: [C1] });
  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({ type: "known_containers.add", containerIds: [C2] }),
    ),
  ).toEqual({ kind: "add", containerIds: [C2] });
  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({ type: "known_containers.remove", containerIds: [C1] }),
    ),
  ).toEqual({ kind: "remove", containerIds: [C1] });
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
  router.hydrateInterest(alice, [C1, C2]);
  router.routeServerEvent(documentEvent([C2]));

  expect(alice.sent).toHaveLength(1);
  expect(router.interestedSocketCount(C1)).toBe(1);
  expect(router.interestedSocketCount(C2)).toBe(1);
});

test("hydrateInterest preserves interest declared during the open window", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);

  // A client message can arrive while open()'s async hydration is still
  // pending; that just-declared interest must survive hydration.
  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers.add", containerIds: [LIVE] }),
  );
  router.hydrateInterest(alice, [PERSISTED]);

  expect(router.interestedSocketCount(LIVE)).toBe(1);
  expect(router.interestedSocketCount(PERSISTED)).toBe(1);
});

test("access_changed evicts interest and tells interested sockets to resync", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  const bob = fakeSocket("bob");
  router.open(alice);
  router.open(bob);
  router.handleClientMessage(
    alice,
    JSON.stringify({ type: "known_containers", containerIds: [X, Y] }),
  );
  router.handleClientMessage(
    bob,
    JSON.stringify({ type: "known_containers", containerIds: [X] }),
  );

  const evictions = router.routeServerEvent(
    JSON.stringify({ type: "access_changed", containerId: X }),
  );

  const resync = JSON.stringify({ containerId: X, type: "resync_required" });
  // Both sockets interested in x are told to resync, and x is dropped from
  // their interest so no further x events reach them until they re-declare.
  expect(alice.sent).toEqual([resync]);
  expect(bob.sent).toEqual([resync]);
  expect(router.interestedSocketCount(X)).toBe(0);
  // Unaffected interest (y) is untouched.
  expect(router.interestedSocketCount(Y)).toBe(1);
  // The evictions are returned so the shell drops them from the persisted set,
  // or a reconnect would restore the just-revoked interest.
  expect(evictions).toEqual([
    { containerId: X, sessionId: "alice-session", userId: "alice" },
    { containerId: X, sessionId: "bob-session", userId: "bob" },
  ]);

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
  router.handleClientMessage(
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

test("rejects malformed and oversized client interest declarations", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);

  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({
        type: "known_containers",
        containerIds: [C1, "not-a-container-id"],
      }),
    ),
  ).toBeNull();
  expect(router.interestedSocketCount(C1)).toBe(0);

  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({
        type: "known_containers",
        containerIds: Array.from(
          { length: 10_001 },
          () => "00000000-0000-4000-8000-000000000010",
        ),
      }),
    ),
  ).toBeNull();
  expect(
    router.interestedSocketCount("00000000-0000-4000-8000-000000000010"),
  ).toBe(0);
});
