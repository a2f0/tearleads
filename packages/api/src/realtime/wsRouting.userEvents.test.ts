import { expect, test } from "bun:test";
import { fakeSocket } from "../../test/helpers/wsRouting";
import { WsEventRouter } from "./wsRouting";

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
