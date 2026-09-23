import { expect, test } from "bun:test";
import {
  CONTAINER,
  fixture,
  OTHER,
  recordingSocket,
} from "../../test/helpers/realtimeContainerAuthorization";
import { publishContainerMutationCreated } from "../routes/containers/mutationEvents";
import type { PublishedRealtimeEvent } from "./publishedRealtimeEvents";

const DESTINATION = "00000000-0000-4000-8000-000000000003";
const UPDATED_AT = "2026-09-13T00:00:00.000Z";

test("a destination-only watcher receives only a child-list refresh", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [DESTINATION]);
  f.publish({
    type: "container_mutation_created",
    containerId: CONTAINER,
    eventType: "container.move",
    parentId: DESTINATION,
    previousParentId: OTHER,
    updatedAt: UPDATED_AT,
  });
  expect(f.sent.at(-1)).toEqual({
    type: "container_children_changed",
    containerIds: [DESTINATION],
  });
  f.gateway.stop();
});

test("a source-only watcher receives only a child-list refresh", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [OTHER]);
  f.publish({
    type: "container_mutation_created",
    containerId: CONTAINER,
    eventType: "container.move",
    parentId: DESTINATION,
    previousParentId: OTHER,
    updatedAt: UPDATED_AT,
  });
  expect(f.sent.at(-1)).toEqual({
    type: "container_children_changed",
    containerIds: [OTHER],
  });
  f.gateway.stop();
});

test("a child watcher keeps the null parent on a root move", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER]);
  f.publish({
    type: "container_mutation_created",
    containerId: CONTAINER,
    eventType: "container.move",
    parentId: null,
    previousParentId: OTHER,
    updatedAt: UPDATED_AT,
  });
  expect(f.sent.at(-1)).toEqual({
    type: "container_mutation_created",
    containerId: CONTAINER,
    eventType: "container.move",
    parentId: null,
    updatedAt: UPDATED_AT,
  });
  f.gateway.stop();
});

test("each document subscriber receives only the linked containers it holds", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  const peer = recordingSocket("peer", "peer-session");
  await Promise.all([
    f.gateway.websocket.open(f.socket),
    f.gateway.websocket.open(peer.socket),
  ]);
  await f.declare("known_containers", [CONTAINER]);
  await f.declare("known_containers", [CONTAINER, OTHER], peer.socket);
  f.publish({
    type: "document_update_created",
    containerIds: [CONTAINER, OTHER],
    documentId: "document",
    updateIds: ["update"],
  });
  expect(f.sent.at(-1)).toEqual({
    type: "document_update_created",
    containerIds: [CONTAINER],
    documentId: "document",
    updateIds: ["update"],
  });
  expect(peer.sent.at(-1)).toEqual({
    type: "document_update_created",
    containerIds: [CONTAINER, OTHER],
    documentId: "document",
    updateIds: ["update"],
  });
  f.gateway.stop();
});

test("a grant on a hot root does not evict its descendants' subscribers", async () => {
  const f = fixture({
    paths: { [CONTAINER]: [OTHER, CONTAINER] },
    authorize: async (_user, ids) => ids,
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER]);
  const published: PublishedRealtimeEvent[] = [];
  await publishContainerMutationCreated({
    expectedEventType: "container.grant",
    origin: { sessionId: "author", userId: "owner" },
    publish: async (event) => {
      published.push(event);
      f.publish(event);
    },
    request: {
      body: {
        eventType: "container.grant",
        grant: { subjectType: "user", subjectId: "reader" },
      },
    },
    response: { containerId: OTHER, parentId: null, updatedAt: UPDATED_AT },
  });
  expect(published.map((event) => event.type)).toEqual([
    "container_mutation_created",
    "shared_with_you",
  ]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  expect(
    f.sent.some((frame) => Reflect.get(frame, "type") === "resync_required"),
  ).toBe(false);
  f.gateway.stop();
});

test("a revoked socket is evicted before the revoke hint is routed", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER]);
  const before = f.sent.length;
  await publishContainerMutationCreated({
    expectedEventType: "container.revoke",
    origin: { sessionId: "author", userId: "owner" },
    publish: async (event) => {
      f.publish(event);
    },
    request: { body: { eventType: "container.revoke" } },
    response: { containerId: CONTAINER, parentId: null, updatedAt: UPDATED_AT },
  });
  expect(f.sent.slice(before)).toEqual([
    { type: "resync_required", containerIds: [CONTAINER] },
  ]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  f.gateway.stop();
});

test("a move evicts a child watcher before sending its parent's generic hint", async () => {
  const f = fixture({
    paths: { [CONTAINER]: [OTHER, CONTAINER] },
    authorize: async (_user, ids) => ids,
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER, OTHER]);
  const before = f.sent.length;
  await publishContainerMutationCreated({
    expectedEventType: "container.move",
    origin: { sessionId: "author", userId: "owner" },
    publish: async (event) => {
      f.publish(event);
    },
    request: {
      body: { eventType: "container.move" },
      previousManifest: {
        event: {},
        manifest: {},
        manifestHash: "previous",
        state: { parentContainerId: OTHER },
      },
    },
    response: { containerId: CONTAINER, parentId: null, updatedAt: UPDATED_AT },
  });
  expect(f.sent.slice(before)).toEqual([
    { type: "resync_required", containerIds: [CONTAINER] },
    { type: "container_children_changed", containerIds: [OTHER] },
  ]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  f.gateway.stop();
});
