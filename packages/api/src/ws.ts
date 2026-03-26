import type { ServerWebSocket } from "bun";
import { addListener } from "./adapters/redisPubSub";

const sockets = new Set<ServerWebSocket<unknown>>();

export const websocket = {
  open(ws: ServerWebSocket<unknown>) {
    sockets.add(ws);
  },
  close(ws: ServerWebSocket<unknown>) {
    sockets.delete(ws);
  },
};

addListener((message) => {
  for (const ws of sockets) {
    ws.send(message);
  }
});
