import type { WsConnection, WsEventRouter } from "../../src/realtime/wsRouting";

export const C1 = "00000000-0000-4000-8000-000000000001";
export const C2 = "00000000-0000-4000-8000-000000000002";

export interface FakeSocket extends WsConnection {
  readonly closed: Array<{
    code: number | undefined;
    reason: string | undefined;
  }>;
  readonly sent: string[];
}

export function fakeSocket(
  userId: string,
  sessionId = `${userId}-session`,
): FakeSocket {
  const closed: FakeSocket["closed"] = [];
  const sent: string[] = [];
  return {
    data: { sessionId, userId },
    closed,
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
    },
    sent,
    send(message: string) {
      sent.push(message);
      return undefined;
    },
  };
}

export function documentEvent(
  containerIds: string[],
  documentId = "doc-1",
): string {
  return JSON.stringify({
    type: "document_update_created",
    containerIds,
    documentId,
    updateIds: ["update-1"],
  });
}

// Routing tests supply trusted interest; gateway tests exercise authorization.
export function applyContainerInterest(
  router: WsEventRouter,
  ws: WsConnection,
  message: string,
) {
  const action = router.handleClientMessage(ws, message);
  if (action && action.kind !== "organization-replace") {
    router.applyAuthorizedContainerInterest(
      ws,
      action,
      action.containerIds.map((containerId) => ({
        containerId,
        pathContainerIds: [containerId],
        principalKeys: [],
      })),
    );
  }
  return action;
}
