import { expect, test } from "bun:test";
import {
  applyContainerInterest,
  C1,
  C2,
  documentEvent,
  fakeSocket,
} from "../../test/helpers/wsRouting";
import { WsEventRouter } from "./wsRouting";

test("applies interest add/remove deltas", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);

  applyContainerInterest(
    router,
    alice,
    JSON.stringify({ type: "known_containers.add", containerIds: [C1] }),
  );
  router.routeServerEvent(documentEvent([C1]));
  expect(alice.sent).toHaveLength(1);

  applyContainerInterest(
    router,
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
  applyContainerInterest(
    router,
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
    applyContainerInterest(
      router,
      alice,
      JSON.stringify({ type: "known_containers", containerIds: [C1] }),
    ),
  ).toEqual({ kind: "replace", containerIds: [C1] });
  expect(
    applyContainerInterest(
      router,
      alice,
      JSON.stringify({ type: "known_containers.add", containerIds: [C2] }),
    ),
  ).toEqual({ kind: "add", containerIds: [C2] });
  expect(
    applyContainerInterest(
      router,
      alice,
      JSON.stringify({ type: "known_containers.remove", containerIds: [C1] }),
    ),
  ).toEqual({ kind: "remove", containerIds: [C1] });
  expect(applyContainerInterest(router, alice, "not json")).toBeNull();
  expect(
    applyContainerInterest(router, alice, JSON.stringify({ type: "other" })),
  ).toBeNull();
});

test("ignores malformed client messages and unscoped events", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);
  applyContainerInterest(router, alice, "not json");
  applyContainerInterest(router, alice, JSON.stringify({ type: "unknown" }));
  router.routeServerEvent("not json");
  router.routeServerEvent(JSON.stringify({ type: "mystery" }));

  expect(alice.sent).toEqual([]);
});

test("rejects malformed and oversized client interest declarations", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket("alice");
  router.open(alice);

  expect(
    applyContainerInterest(
      router,
      alice,
      JSON.stringify({
        type: "known_containers",
        containerIds: [C1, "not-a-container-id"],
      }),
    ),
  ).toBeNull();
  expect(router.interestedSocketCount(C1)).toBe(0);

  expect(
    applyContainerInterest(
      router,
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
