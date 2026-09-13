import { expect, spyOn, test } from "bun:test";
import {
  CONTAINER,
  fixture,
  OTHER,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as sentry from "../diagnostics/sentry";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a pre-outage query that answers after reconnect is not installed", async () => {
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  let readable = new Set([CONTAINER, OTHER]);
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const f = fixture({
    timeoutMs: 20,
    authorize: async (_user, ids) => {
      // Access is read when the query starts; a slow answer carries that
      // snapshot forward past the outage.
      const granted = ids.filter((id) => readable.has(id));
      if (++calls === 2) await release.promise;
      return granted;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    f.reconnect();
    await flush();
    expect(calls).toBe(2);
    // The pass times out; the raw query keeps its slot until it settles.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    // Revoked during the outage; the invalidation is gone for good.
    readable = new Set([OTHER]);
    f.reconnect();
    await flush();
    expect(calls).toBe(2);
    release.resolve();
    for (let i = 0; i < 4; i++) await flush();
    // The stale answer was awaited, not shared: a fresh query refused the id.
    expect(calls).toBe(3);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.router.interestedSocketCount(OTHER)).toBe(1);
    expect(
      f.sent.filter(
        (frame) => Reflect.get(frame, "type") === "resync_required",
      ),
    ).toEqual([{ type: "resync_required", containerIds: [CONTAINER, OTHER] }]);
    expect(f.persisted.at(-1)).toEqual({
      kind: "remove",
      containerIds: [CONTAINER],
    });
    expect(f.closed).toEqual([]);
  } finally {
    release.resolve();
    capture.mockRestore();
    f.gateway.stop();
  }
});
