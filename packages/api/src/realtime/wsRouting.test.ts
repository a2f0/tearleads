import { expect, test } from "bun:test";
import {
  applyContainerInterest,
  C1,
  C2,
  documentEvent,
  fakeSocket,
} from "../../test/helpers/wsRouting";
import { WsEventRouter } from "./wsRouting";

const CHILD = "00000000-0000-4000-8000-000000000003";
const PARENT = "00000000-0000-4000-8000-000000000005";
const SHARED = "00000000-0000-4000-8000-000000000007";

test("delivers a document event only to sockets interested in its containers", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  const bob = fakeSocket("bob");
  router.open(alice);
  router.open(bob);

  applyContainerInterest(
    router,
    alice,
    JSON.stringify({ type: "known_containers", containerIds: [C1, C2] }),
  );
  applyContainerInterest(
    router,
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
  applyContainerInterest(
    router,
    authorTab,
    JSON.stringify({ type: "known_containers", containerIds: [C1] }),
  );
  applyContainerInterest(
    router,
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
  applyContainerInterest(
    router,
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
  applyContainerInterest(
    router,
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
  applyContainerInterest(
    router,
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
  applyContainerInterest(
    router,
    alice,
    JSON.stringify({ type: "known_containers", containerIds: [SHARED] }),
  );
  applyContainerInterest(
    router,
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
  applyContainerInterest(
    router,
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
  expect(parentWatcher.sent).toEqual([
    JSON.stringify({
      type: "container_children_changed",
      containerIds: [PARENT],
    }),
  ]);
});

test("delivers an origin-tagged container create to the author's other session, not the author", () => {
  const router = new WsEventRouter();
  const authorTab = fakeSocket("alice", "alice-a");
  const recoveredPeer = fakeSocket("alice", "alice-b");
  router.open(authorTab);
  router.open(recoveredPeer);
  // Both sessions of the same identity already know the parent (root) container.
  for (const ws of [authorTab, recoveredPeer]) {
    applyContainerInterest(
      router,
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
      type: "container_children_changed",
      containerIds: [PARENT],
    }),
  ]);
});
