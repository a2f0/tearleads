import { expect, test } from "bun:test";
import {
  CONTAINER,
  fixture,
  OTHER,
  recordingSocket,
} from "../../test/helpers/realtimeContainerAuthorization";

const ANCESTOR = "00000000-0000-4000-8000-00000000000a";
const UPDATED_AT = "2026-09-13T00:00:00.000Z";

function framesOf(sent: ReadonlyArray<Record<string, unknown>>, type: string) {
  return sent.filter((frame) => Reflect.get(frame, "type") === type);
}

test("an ancestor mutation tells dependents which held containers cite it, evicting nothing", async () => {
  // CONTAINER is granted directly under ANCESTOR (its verified path cites it);
  // OTHER is an unrelated subtree on a second socket.
  const f = fixture({
    paths: { [CONTAINER]: [ANCESTOR, CONTAINER], [OTHER]: [OTHER] },
    authorize: async (_user, ids) => ids,
  });
  const sibling = recordingSocket("sibling", "session-2");
  await f.gateway.websocket.open(f.socket);
  await f.gateway.websocket.open(sibling.socket);
  await f.declare("known_containers", [CONTAINER]);
  await f.declare("known_containers", [OTHER], sibling.socket);

  f.publish({
    type: "container_mutation_created",
    containerId: ANCESTOR,
    eventType: "container.grant",
    parentId: null,
    updatedAt: UPDATED_AT,
  });

  // The descendant's watcher holds no interest in the ancestor, so the
  // mutation hint itself never reaches it; the path hint is its only signal.
  expect(framesOf(f.sent, "container_mutation_created")).toEqual([]);
  expect(framesOf(f.sent, "container_path_changed")).toEqual([
    { type: "container_path_changed", containerIds: [CONTAINER] },
  ]);
  expect(framesOf(f.sent, "resync_required")).toEqual([]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  expect(framesOf(sibling.sent, "container_path_changed")).toEqual([]);
  expect(f.persisted.filter((action) => action?.kind === "remove")).toEqual([]);
  f.gateway.stop();
});

test("the mutated container itself is left to its own hint", async () => {
  const f = fixture({
    paths: { [CONTAINER]: [CONTAINER] },
    authorize: async (_user, ids) => ids,
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER]);
  f.publish({
    type: "container_mutation_created",
    containerId: CONTAINER,
    eventType: "container.rekey",
    parentId: null,
    updatedAt: UPDATED_AT,
  });
  expect(framesOf(f.sent, "container_mutation_created")).toHaveLength(1);
  expect(framesOf(f.sent, "container_path_changed")).toEqual([]);
  f.gateway.stop();
});
