import { expect, test } from "bun:test";
import {
  CONTAINER,
  fixture,
} from "../../test/helpers/realtimeContainerAuthorization";

const principal = { principalType: "group", principalId: "readers" };
const principalKeys = ["principal:group:readers"];

test("membership changes evict subscriptions that depend on that principal", async () => {
  const f = fixture({ principalKeys, authorize: async (_user, ids) => ids });
  await f.gateway.websocket.open(f.socket);
  await f.declare();
  f.publish({
    type: "principal_access_changed",
    ...principal,
    principalId: "unrelated",
  });
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  f.publish({ type: "principal_access_changed", ...principal });
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.sent.at(-1)).toEqual({
    type: "resync_required",
    containerId: CONTAINER,
  });
  f.gateway.stop();
});

test("membership changes invalidate a pending authorization before installation", async () => {
  const started = Promise.withResolvers<void>();
  const authorization = Promise.withResolvers<string[]>();
  let calls = 0;
  const f = fixture({
    principalKeys,
    authorize: () => {
      started.resolve();
      return ++calls === 1 ? authorization.promise : Promise.resolve([]);
    },
  });
  await f.gateway.websocket.open(f.socket);
  const pending = f.declare();
  await started.promise;
  f.publish({ type: "principal_access_changed", ...principal });
  authorization.resolve([CONTAINER]);
  await pending;
  expect(calls).toBe(2);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.closed).toEqual([]);
  f.gateway.stop();
});
