import type { Tearleads } from "@tearleads/client-sdk";
import { handleOrganizationReadModelInterestAcknowledgement } from "../organizationReadModelRealtime";

export const ORGANIZATION_A = "00000000-0000-4000-8000-00000000000a";
export const ORGANIZATION_B = "00000000-0000-4000-8000-00000000000b";
const USER_A = "00000000-0000-4000-8000-00000000001a";
export const USER_B = "00000000-0000-4000-8000-00000000001b";

export function createRuntimeHarness(input?: {
  readonly execSql?: (sql: string) => Promise<unknown[]>;
  readonly loadDirectoryAndGroups?: () => Promise<unknown>;
}) {
  let auth = {
    isAuthenticated: true,
    organizationId: ORGANIZATION_A as string | null,
    userId: USER_A,
  };
  let domainScope = {};
  const online = true;
  let containerCalls = 0;
  let documentCalls = 0;
  let reconcileCalls = 0;
  // A defined default models a reconcile that reached the feed; passes that
  // resolve undefined are declines and must not mark the scope caught up.
  const loadDirectoryAndGroups = async () => {
    reconcileCalls += 1;
    return input?.loadDirectoryAndGroups ? input.loadDirectoryAndGroups() : {};
  };
  const tearleads = {
    containerContents: {
      openTree: () => {
        containerCalls += 1;
        throw new Error("organization hints must not open the container tree");
      },
    },
    deviceFirst: {
      reconciler: () => {
        documentCalls += 1;
        throw new Error("organization hints must not start document sync");
      },
    },
    organizations: {
      loadDirectoryAndGroups,
      loadDirectoryAndGroupsAfterMutation: loadDirectoryAndGroups,
    },
    runtime: {
      // Invalidation subscriptions register only against a ready database;
      // harness runs without one unless a test supplies an execSql stub.
      input: () => ({
        auth,
        infra: input?.execSql
          ? { dbStatus: "ready", execSql: input.execSql }
          : { dbStatus: "idle" },
        state: { domainScope, online },
      }),
    },
  } as unknown as Tearleads;

  return {
    get containerCalls() {
      return containerCalls;
    },
    get documentCalls() {
      return documentCalls;
    },
    get reconcileCalls() {
      return reconcileCalls;
    },
    setOrganizationId(organizationId: string | null) {
      auth = { ...auth, organizationId };
    },
    setUserId(userId: string) {
      auth = { ...auth, userId };
    },
    transitionDomainScope() {
      domainScope = {};
    },
    tearleads,
  };
}

export function fakeOpenSocket() {
  const sent: string[] = [];
  return {
    sent,
    ws: {
      readyState: WebSocket.OPEN,
      send: (message: string) => sent.push(message),
    } as unknown as WebSocket,
  };
}

export function parsedMessages(messages: readonly string[]) {
  return messages.map((message) => JSON.parse(message));
}

export function acknowledgeLatestDeclaration(
  tearleads: Tearleads,
  socket: ReturnType<typeof fakeOpenSocket>,
  authorized = true,
): void {
  const declaration = JSON.parse(socket.sent.at(-1) ?? "null") as {
    declarationId?: unknown;
    organizationIds?: unknown;
  } | null;
  if (
    !declaration ||
    typeof declaration.declarationId !== "string" ||
    !Array.isArray(declaration.organizationIds)
  ) {
    throw new Error("Expected an organization interest declaration");
  }
  handleOrganizationReadModelInterestAcknowledgement(
    tearleads,
    socket.ws,
    declaration.declarationId,
    typeof declaration.organizationIds[0] === "string"
      ? declaration.organizationIds[0]
      : null,
    authorized,
  );
}
