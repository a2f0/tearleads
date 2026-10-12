import { afterEach, expect, test } from "bun:test";
import {
  CONTAINER,
  OTHER,
  recordingSocket,
  virtualClock,
} from "../../test/helpers/realtimeContainerAuthorization";
import { createRealtimeGateway } from "./realtimeGateway";

const stop: Array<() => void> = [];
afterEach(() => {
  for (const close of stop.splice(0)) close();
});

function gateway(clock: ReturnType<typeof virtualClock>) {
  const instance = createRealtimeGateway({
    revalidation: {
      intervalMs: 100,
      maxProofAgeMs: 300,
      now: clock.now,
      schedule: clock.schedule,
      random: () => 0,
    },
    interestStore: { load: async () => [], apply: async () => {} },
    authorizeContainerAccess: async (_user, ids) =>
      ids.map((containerId) => ({
        containerId,
        pathContainerIds: [OTHER, containerId],
        principalKeys: ["principal:group:g"],
      })),
    authorizeOrganizationAccess: async () => true,
    validateSession: async () => true,
  });
  stop.push(instance.stop);
  return instance;
}

const declare = (id: string) =>
  JSON.stringify({
    type: "known_containers",
    declarationId: id,
    containerIds: [id],
  });

test("restores per-socket interests and dependencies without a client declaration", async () => {
  const clock = virtualClock();
  const original = gateway(clock);
  const a = recordingSocket(OTHER, "session");
  const b = recordingSocket(OTHER, "session");
  await original.websocket.open(a.socket);
  await original.websocket.open(b.socket);
  await original.websocket.message(a.socket, declare(CONTAINER));
  await original.websocket.message(b.socket, declare(OTHER));
  const savedA = original.hibernation.snapshot(a.socket);
  const savedB = original.hibernation.snapshot(b.socket);
  if (!savedA || !savedB) throw new Error("Missing snapshots");
  original.stop();
  a.sent.length = b.sent.length = 0;
  const restored = gateway(clock);
  await restored.hibernation.restore(a.socket, savedA);
  await restored.hibernation.restore(b.socket, savedB);
  expect(restored.hibernation.snapshot(a.socket)).toEqual(savedA);
  expect(restored.hibernation.snapshot(b.socket)).toEqual(savedB);
  expect(a.sent).toEqual([]);
  await restored.publish(
    JSON.stringify({ type: "access_changed", containerId: OTHER }),
  );
  expect(a.sent).toEqual([
    { type: "resync_required", containerIds: [CONTAINER] },
  ]);
  expect(b.sent).toEqual([{ type: "resync_required", containerIds: [OTHER] }]);
});

test("wake-up preserves the next periodic check and both original deadlines", async () => {
  const clock = virtualClock();
  const original = gateway(clock);
  const socket = recordingSocket(OTHER, "session");
  await original.websocket.open(socket.socket);
  await original.websocket.message(socket.socket, declare(CONTAINER));
  const saved = original.hibernation.snapshot(socket.socket);
  if (!saved) throw new Error("Missing snapshot");
  original.stop();
  await clock.advance(40);
  const restored = gateway(clock);
  await restored.hibernation.restore(socket.socket, saved);
  expect(restored.hibernation.snapshot(socket.socket)).toEqual(saved);
  await clock.advance(10);
  expect(
    restored.hibernation.snapshot(socket.socket)?.session.confirmedAt,
  ).toBe(50);
});

test("an expired restored session closes before a new confirmation can extend it", async () => {
  const clock = virtualClock();
  const original = gateway(clock);
  const socket = recordingSocket(OTHER, "session");
  await original.websocket.open(socket.socket);
  const saved = original.hibernation.snapshot(socket.socket);
  if (!saved) throw new Error("Missing snapshot");
  original.stop();
  await clock.advance(301);
  const restored = gateway(clock);
  await restored.hibernation.restore(socket.socket, saved);
  await clock.advance(0);
  expect(socket.closed).toEqual([{ code: 1013, reason: "Session unverified" }]);
  expect(restored.hibernation.snapshot(socket.socket)).toBeNull();
});

test("organization declarations remain routable after hibernation", async () => {
  const clock = virtualClock();
  const original = gateway(clock);
  const socket = recordingSocket(OTHER, "session");
  await original.websocket.open(socket.socket);
  await original.websocket.message(
    socket.socket,
    JSON.stringify({
      type: "known_organizations",
      declarationId: "org",
      organizationIds: [CONTAINER],
    }),
  );
  const saved = original.hibernation.snapshot(socket.socket);
  if (!saved) throw new Error("Missing snapshot");
  original.stop();
  socket.sent.length = 0;
  const restored = gateway(clock);
  await restored.hibernation.restore(socket.socket, saved);
  await restored.publish(
    JSON.stringify({
      type: "organization_read_model_changed",
      organizationId: CONTAINER,
      recipientUserIds: [OTHER],
    }),
  );
  expect(socket.sent).toEqual([
    {
      type: "organization_read_model_changed",
      organizationId: CONTAINER,
      originatedFromSession: false,
    },
  ]);
});
