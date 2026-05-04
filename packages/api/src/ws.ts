import type { ServerWebSocket } from "bun";
import { db } from "./adapters/postgres";
import { addListener } from "./adapters/redisPubSub";
import { resolveReadableDocumentAccess } from "./services/keyingReadAccess";
import type { SessionData } from "./validators/session";

const sockets = new Set<ServerWebSocket<SessionData>>();

const pendingSends = new Map<ServerWebSocket<SessionData>, Promise<void>>();

function chainSend(
  ws: ServerWebSocket<SessionData>,
  fn: () => void,
): Promise<void> {
  const prev = pendingSends.get(ws) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  pendingSends.set(ws, next);
  return next;
}

export const websocket = {
  open(ws: ServerWebSocket<SessionData>) {
    sockets.add(ws);
  },
  close(ws: ServerWebSocket<SessionData>) {
    sockets.delete(ws);
    pendingSends.delete(ws);
  },
};

addListener((message) => {
  let event: { type?: string; documentId?: string };
  try {
    event = JSON.parse(message);
  } catch {
    return;
  }

  if (event.type === "document_update_created") {
    if (!event.documentId) return;

    // Group sockets by userId to minimize redundant database queries
    const userMap = new Map<string, Set<ServerWebSocket<SessionData>>>();
    for (const ws of sockets) {
      const userId = ws.data?.userId;
      if (userId) {
        const set = userMap.get(userId) ?? new Set();
        set.add(ws);
        userMap.set(userId, set);
      }
    }

    for (const [userId, userSockets] of userMap) {
      resolveReadableDocumentAccess({
        documentId: event.documentId,
        executor: db,
        userId,
      }).then(
        () => {
          for (const ws of userSockets) {
            chainSend(ws, () => {
              ws.send(message);
            });
          }
        },
        () => {
          // User lacks read access; skip.
        },
      );
    }
    return;
  }

  for (const ws of sockets) {
    chainSend(ws, () => {
      ws.send(message);
    });
  }
});
