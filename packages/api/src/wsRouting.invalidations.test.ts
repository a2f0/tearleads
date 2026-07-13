import { expect, test } from "bun:test";
import { type WsConnection, WsEventRouter } from "./wsRouting";

const AFFECTED_A = "00000000-0000-4000-8000-000000000101";
const AFFECTED_B = "00000000-0000-4000-8000-000000000102";
const UNRELATED = "00000000-0000-4000-8000-000000000103";

interface FakeSocket extends WsConnection {
  readonly sent: string[];
}

function fakeSocket(userId: string, sessionId: string): FakeSocket {
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

function declareInterest(
  router: WsEventRouter,
  socket: FakeSocket,
  containerIds: readonly string[],
): void {
  router.open(socket);
  router.handleClientMessage(
    socket,
    JSON.stringify({ type: "known_containers", containerIds }),
  );
}

function expectInvalidationRouting(event: Record<string, unknown>): void {
  const router = new WsEventRouter();
  const author = fakeSocket("alice", "alice-author");
  const sameIdentityPeer = fakeSocket("alice", "alice-peer");
  const otherContainerPeer = fakeSocket("alice", "alice-other-container");
  const unrelatedSession = fakeSocket("mallory", "mallory-session");

  declareInterest(router, author, [AFFECTED_A]);
  declareInterest(router, sameIdentityPeer, [AFFECTED_A]);
  declareInterest(router, otherContainerPeer, [AFFECTED_B]);
  declareInterest(router, unrelatedSession, [UNRELATED]);
  router.routeServerEvent(JSON.stringify(event));

  const { origin: _origin, ...clientEvent } = event;
  const clientMessage = JSON.stringify(clientEvent);
  expect(author.sent).toEqual([]);
  expect(sameIdentityPeer.sent).toEqual([clientMessage]);
  expect(otherContainerPeer.sent).toEqual([clientMessage]);
  expect(unrelatedSession.sent).toEqual([]);
}

test("routes purge invalidations to tombstone-container peers only", () => {
  expectInvalidationRouting({
    type: "document_mutation_created",
    containerIds: [AFFECTED_A, AFFECTED_B],
    documentId: "document-1",
    eventType: "document.purge",
    origin: { sessionId: "alice-author", userId: "alice" },
  });
});

test("routes detach invalidations to linked-container peers only", () => {
  expectInvalidationRouting({
    type: "document_update_created",
    containerIds: [AFFECTED_A, AFFECTED_B],
    documentId: "document-1",
    origin: { sessionId: "alice-author", userId: "alice" },
  });
});
