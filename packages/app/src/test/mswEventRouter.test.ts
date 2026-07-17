import { describe, expect, test } from "bun:test";
import {
  createMswEventRouter,
  type MswSocketClient,
} from "../../test/helpers/mswEventRouter";

const ORGANIZATION_A = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTAINER_A = "33333333-3333-4333-8333-333333333333";

class FakeSocketClient implements MswSocketClient {
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<
    "close" | "message",
    Array<(event: { data?: unknown }) => void>
  >();

  constructor(ticket: string) {
    this.url = `ws://localhost/events?ticket=${ticket}`;
  }

  addEventListener(
    type: "close" | "message",
    listener: (event: { data?: unknown }) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    for (const listener of this.listeners.get("close") ?? []) {
      listener({});
    }
  }

  message(value: Record<string, unknown>): void {
    const event = { data: JSON.stringify(value) };
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

function parsedMessages(client: FakeSocketClient): unknown[] {
  return client.sent.map((message) => JSON.parse(message) as unknown);
}

function connect(
  router: ReturnType<typeof createMswEventRouter>,
  ticket: string,
): FakeSocketClient {
  const client = new FakeSocketClient(ticket);
  router.handleConnection(client);
  client.sent.length = 0;
  return client;
}

function declareOrganization(
  client: FakeSocketClient,
  organizationIds: string[],
): void {
  client.message({ type: "known_organizations", organizationIds });
}

describe("MSW organization event routing", () => {
  test("routes a minimal author echo only through interest and audience", async () => {
    const router = createMswEventRouter({
      resolveTicketIdentity: async (ticket) => {
        if (ticket === "alice") {
          return { sessionId: "shared-session", userId: USER_A };
        }
        if (ticket === "alice-peer") {
          return { sessionId: "other-session", userId: USER_A };
        }
        return { sessionId: "bob-session", userId: USER_B };
      },
    });
    const author = connect(router, "alice");
    const otherSession = connect(router, "alice-peer");
    const excluded = connect(router, "bob");
    const otherOrganization = connect(router, "alice");
    declareOrganization(author, [ORGANIZATION_A]);
    declareOrganization(otherSession, [ORGANIZATION_A]);
    declareOrganization(excluded, [ORGANIZATION_A]);
    declareOrganization(otherOrganization, [ORGANIZATION_B]);

    await router.publish({
      type: "organization_read_model_changed",
      organizationId: ORGANIZATION_A,
      recipientUserIds: [USER_A],
      origin: { sessionId: "shared-session", userId: USER_A },
      internalOnly: "must not reach clients",
    });

    expect(parsedMessages(author)).toEqual([
      {
        type: "organization_read_model_changed",
        organizationId: ORGANIZATION_A,
        originatedFromSession: true,
      },
    ]);
    expect(parsedMessages(otherSession)).toEqual([
      {
        type: "organization_read_model_changed",
        organizationId: ORGANIZATION_A,
        originatedFromSession: false,
      },
    ]);
    expect(parsedMessages(excluded)).toEqual([
      {
        type: "organization_read_model_access_revoked",
        organizationId: ORGANIZATION_A,
      },
    ]);
    expect(otherOrganization.sent).toEqual([]);
    router.clear();
  });

  test("notifies audience loss once and resumes after re-inclusion", async () => {
    const router = createMswEventRouter({
      resolveTicketIdentity: async () => ({
        sessionId: "alice-session",
        userId: USER_A,
      }),
    });
    const alice = connect(router, "alice");
    declareOrganization(alice, [ORGANIZATION_A]);
    const publishTo = (recipientUserIds: string[]) =>
      router.publish({
        type: "organization_read_model_changed",
        organizationId: ORGANIZATION_A,
        recipientUserIds,
      });

    await publishTo([USER_A]);
    await publishTo([USER_B]);
    await publishTo([USER_B]);
    await publishTo([USER_A]);
    await publishTo([USER_B]);

    expect(parsedMessages(alice)).toEqual([
      {
        type: "organization_read_model_changed",
        organizationId: ORGANIZATION_A,
        originatedFromSession: false,
      },
      {
        type: "organization_read_model_access_revoked",
        organizationId: ORGANIZATION_A,
      },
      {
        type: "organization_read_model_changed",
        organizationId: ORGANIZATION_A,
        originatedFromSession: false,
      },
      {
        type: "organization_read_model_access_revoked",
        organizationId: ORGANIZATION_A,
      },
    ]);
    router.clear();
  });

  test("replaces organization interest and rejects malformed audiences", async () => {
    const router = createMswEventRouter({
      resolveTicketIdentity: async () => ({
        sessionId: "alice-session",
        userId: USER_A,
      }),
    });
    const alice = connect(router, "alice");
    declareOrganization(alice, [ORGANIZATION_A]);
    declareOrganization(alice, [ORGANIZATION_A, ORGANIZATION_B]);
    declareOrganization(alice, [ORGANIZATION_B]);

    await router.publish({
      type: "organization_read_model_changed",
      organizationId: ORGANIZATION_A,
      recipientUserIds: [USER_A],
    });
    await router.publish({
      type: "organization_read_model_changed",
      organizationId: ORGANIZATION_B,
      recipientUserIds: ["not-a-user-id"],
    });

    expect(alice.sent).toEqual([]);
    router.clear();
  });

  test("keeps existing container interest routing intact", async () => {
    const router = createMswEventRouter();
    const client = connect(router, "anonymous");
    client.message({
      type: "known_containers.add",
      containerIds: [CONTAINER_A],
    });

    await router.publish({
      type: "document_changed",
      containerId: CONTAINER_A,
    });

    expect(parsedMessages(client)).toEqual([
      { type: "document_changed", containerId: CONTAINER_A },
    ]);
    router.clear();
  });
});
