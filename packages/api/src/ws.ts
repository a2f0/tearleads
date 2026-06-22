import type { ServerWebSocket } from "bun";
import { addListener } from "./adapters/redisPubSub";
import { wsInterestStore } from "./wsInterestStore";
import type { AppliedInterest } from "./wsRouting";
import { WsEventRouter } from "./wsRouting";
import type { WebSocketTicketIdentity } from "./wsTicket";

const router = new WsEventRouter();

// Serialize interest writes per session so out-of-order persistence can't corrupt
// the set — e.g. a `replace` (which deletes the key) must not land after a later
// `add`. Routing still happens synchronously in the router; only the Redis mirror
// is chained, so persistence never adds routing latency.
const interestWriteChains = new Map<string, Promise<void>>();

function messageToString(message: string | Buffer): string {
  return typeof message === "string" ? message : message.toString("utf8");
}

function persistInterestInOrder(
  ws: ServerWebSocket<WebSocketTicketIdentity>,
  applied: AppliedInterest,
): void {
  const sessionKey = `${ws.data.userId}:${ws.data.sessionId}`;
  const chain = (interestWriteChains.get(sessionKey) ?? Promise.resolve())
    .then(() =>
      wsInterestStore.apply(ws.data.userId, ws.data.sessionId, applied),
    )
    .catch((error: unknown) => {
      console.error("Failed to persist websocket interest:", error);
    });
  interestWriteChains.set(sessionKey, chain);
  void chain.finally(() => {
    if (interestWriteChains.get(sessionKey) === chain) {
      interestWriteChains.delete(sessionKey);
    }
  });
}

/**
 * Hydrate the reconnecting socket's interest from its persisted set and tell the
 * client the baseline the server already holds, so it can send only deltas
 * instead of re-declaring its whole known set. Always sends `interest_state`
 * (empty on a fresh session or on a load failure) so the client has a single,
 * reliable signal to start declaring against.
 */
async function hydrateSocketInterest(
  ws: ServerWebSocket<WebSocketTicketIdentity>,
): Promise<void> {
  let containerIds: string[] = [];
  try {
    containerIds = await wsInterestStore.load(
      ws.data.userId,
      ws.data.sessionId,
    );
    if (containerIds.length > 0) {
      router.hydrateInterest(ws, containerIds);
    }
  } catch (error) {
    console.error("Failed to hydrate websocket interest:", error);
    containerIds = [];
  }
  ws.send(JSON.stringify({ type: "interest_state", containerIds }));
}

export const websocket = {
  async open(ws: ServerWebSocket<WebSocketTicketIdentity>) {
    router.open(ws);
    await hydrateSocketInterest(ws);
  },
  close(ws: ServerWebSocket<WebSocketTicketIdentity>) {
    // Interest is intentionally NOT cleared here: it persists (TTL-bounded) so a
    // reconnect on the same session hydrates it. A re-login uses a new session
    // key; abandoned interest self-expires.
    router.close(ws);
  },
  message(
    ws: ServerWebSocket<WebSocketTicketIdentity>,
    message: string | Buffer,
  ) {
    const applied = router.handleClientMessage(ws, messageToString(message));
    if (applied) {
      persistInterestInOrder(ws, applied);
    }
  },
};

// Redis pub/sub fans every event to every API process; this process routes each
// event only to its locally-connected sockets that declared interest.
addListener((message) => {
  router.routeServerEvent(message);
});
