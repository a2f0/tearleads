import type { ServerWebSocket } from "bun";
import { db } from "./adapters/postgres";
import { addListener } from "./adapters/redisPubSub";
import { resolveReadableDocumentAccess } from "./services/keyingReadAccess";
import type { SessionData } from "./validators/session";

const sockets = new Set<ServerWebSocket<SessionData>>();

export const websocket = {
  open(ws: ServerWebSocket<SessionData>) {
    sockets.add(ws);
  },
  close(ws: ServerWebSocket<SessionData>) {
    sockets.delete(ws);
  },
};

addListener((message) => {
  let event: { type?: string; documentId?: string };
  try {
    event = JSON.parse(message);
  } catch {
    return;
  }

  if (event.type === "document_update_created" && event.documentId) {
    for (const ws of sockets) {
      const session = ws.data;
      if (!session?.userId) continue;

      resolveReadableDocumentAccess({
        documentId: event.documentId,
        executor: db,
        userId: session.userId,
      }).then(
        () => {
          ws.send(message);
        },
        () => {
          // User lacks read access to this document; skip.
        },
      );
    }
    return;
  }

  for (const ws of sockets) {
    ws.send(message);
  }
});
