import { expect, test } from "bun:test";
import { type WsConnection, WsEventRouter } from "./wsRouting";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const USER_A = "10000000-0000-4000-8000-00000000000a";
const USER_B = "20000000-0000-4000-8000-00000000000b";
const DECLARATION_ID = "organization-interest-a";

interface FakeSocket extends WsConnection {
  readonly sent: string[];
}

function fakeSocket(
  userId: string,
  sessionId = `${userId}-session`,
): FakeSocket {
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

function declareAuthorizedOrganization(
  router: WsEventRouter,
  ws: WsConnection,
  organizationId: string | null,
): void {
  const action = router.handleClientMessage(
    ws,
    JSON.stringify({
      type: "known_organizations",
      declarationId: DECLARATION_ID,
      organizationIds: organizationId ? [organizationId] : [],
    }),
  );
  expect(action).toEqual({
    declarationId: DECLARATION_ID,
    kind: "organization-replace",
    organizationId,
  });
  router.applyAuthorizedOrganizationInterest(ws, organizationId);
}

test("routes minimal organization hints to the audience including the author session", () => {
  const router = new WsEventRouter();
  const author = fakeSocket(USER_A, "shared-session");
  const sameSessionPeer = fakeSocket(USER_A, "shared-session");
  const otherSession = fakeSocket(USER_A, "other-session");
  const otherOrganization = fakeSocket(USER_B);
  router.open(author);
  router.open(sameSessionPeer);
  router.open(otherSession);
  router.open(otherOrganization);
  declareAuthorizedOrganization(router, author, ORG_A);
  declareAuthorizedOrganization(router, sameSessionPeer, ORG_A);
  declareAuthorizedOrganization(router, otherSession, ORG_A);
  declareAuthorizedOrganization(router, otherOrganization, ORG_B);

  router.routeServerEvent(
    JSON.stringify({
      type: "organization_read_model_changed",
      organizationId: ORG_A,
      recipientUserIds: [USER_A],
      origin: { sessionId: "shared-session", userId: USER_A },
      internalOnly: "must not cross the websocket boundary",
    }),
  );

  const clientMessage = {
    type: "organization_read_model_changed",
    organizationId: ORG_A,
    originatedFromSession: true,
  };
  expect(author.sent.map((message) => JSON.parse(message))).toEqual([
    clientMessage,
  ]);
  expect(sameSessionPeer.sent.map((message) => JSON.parse(message))).toEqual([
    clientMessage,
  ]);
  expect(otherSession.sent.map((message) => JSON.parse(message))).toEqual([
    { ...clientMessage, originatedFromSession: false },
  ]);
  expect(otherOrganization.sent).toEqual([]);
});

test("organization interest replaces scope and is removed on close", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket(USER_A);
  router.open(alice);
  declareAuthorizedOrganization(router, alice, ORG_A);
  declareAuthorizedOrganization(router, alice, ORG_B);

  router.routeServerEvent(
    JSON.stringify({
      type: "organization_read_model_changed",
      organizationId: ORG_A,
      recipientUserIds: [USER_A],
    }),
  );
  expect(alice.sent).toEqual([]);

  router.routeServerEvent(
    JSON.stringify({
      type: "organization_read_model_changed",
      organizationId: ORG_B,
      recipientUserIds: [USER_A],
    }),
  );
  expect(alice.sent).toHaveLength(1);

  router.close(alice);
  router.routeServerEvent(
    JSON.stringify({
      type: "organization_read_model_changed",
      organizationId: ORG_B,
      recipientUserIds: [USER_A],
    }),
  );
  expect(alice.sent).toHaveLength(1);
});

test("rejects malformed organization interest declarations", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket(USER_A);
  router.open(alice);

  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({
        type: "known_organizations",
        declarationId: DECLARATION_ID,
        organizationIds: [ORG_A, ORG_B],
      }),
    ),
  ).toBeNull();
  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({
        type: "known_organizations",
        declarationId: DECLARATION_ID,
        organizationIds: ["not-an-organization-id"],
      }),
    ),
  ).toBeNull();
  for (const declarationId of [undefined, "", 42, "x".repeat(129)]) {
    expect(
      router.handleClientMessage(
        alice,
        JSON.stringify({
          type: "known_organizations",
          declarationId,
          organizationIds: [ORG_A],
        }),
      ),
    ).toBeNull();
  }

  router.routeServerEvent(
    JSON.stringify({
      type: "organization_read_model_changed",
      organizationId: ORG_A,
      recipientUserIds: [USER_A],
    }),
  );
  expect(alice.sent).toEqual([]);
});

test("accepts an organization declaration ID at the maximum length", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket(USER_A);
  const declarationId = "x".repeat(128);
  router.open(alice);

  expect(
    router.handleClientMessage(
      alice,
      JSON.stringify({
        type: "known_organizations",
        declarationId,
        organizationIds: [ORG_A],
      }),
    ),
  ).toEqual({
    declarationId,
    kind: "organization-replace",
    organizationId: ORG_A,
  });
});

test("drops organization events without a strict authoritative audience", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket(USER_A);
  router.open(alice);
  declareAuthorizedOrganization(router, alice, ORG_A);

  for (const event of [
    { type: "organization_read_model_changed", organizationId: ORG_A },
    {
      type: "organization_read_model_changed",
      organizationId: ORG_A,
      recipientUserIds: [USER_A, "not-a-user-id"],
    },
  ]) {
    router.routeServerEvent(JSON.stringify(event));
  }

  expect(alice.sent).toEqual([]);
});

test("notifies an audience revocation once and restores later delivery", () => {
  const router = new WsEventRouter();
  const alice = fakeSocket(USER_A);
  const bob = fakeSocket(USER_B);
  router.open(alice);
  router.open(bob);
  declareAuthorizedOrganization(router, alice, ORG_A);
  declareAuthorizedOrganization(router, bob, ORG_A);

  const publishTo = (recipientUserIds: string[]) =>
    router.routeServerEvent(
      JSON.stringify({
        type: "organization_read_model_changed",
        organizationId: ORG_A,
        recipientUserIds,
      }),
    );

  publishTo([USER_A, USER_B]);
  publishTo([USER_B]);
  publishTo([USER_B]);
  expect(alice.sent.map((message) => JSON.parse(message))).toEqual([
    {
      type: "organization_read_model_changed",
      organizationId: ORG_A,
      originatedFromSession: false,
    },
    {
      type: "organization_read_model_access_revoked",
      organizationId: ORG_A,
    },
  ]);
  expect(bob.sent).toHaveLength(3);

  publishTo([USER_A, USER_B]);
  publishTo([USER_B]);
  expect(alice.sent.map((message) => JSON.parse(message))).toEqual([
    {
      type: "organization_read_model_changed",
      organizationId: ORG_A,
      originatedFromSession: false,
    },
    {
      type: "organization_read_model_access_revoked",
      organizationId: ORG_A,
    },
    {
      type: "organization_read_model_changed",
      organizationId: ORG_A,
      originatedFromSession: false,
    },
    {
      type: "organization_read_model_access_revoked",
      organizationId: ORG_A,
    },
  ]);
});
