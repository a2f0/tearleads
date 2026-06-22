import type { ServerWebSocket } from "bun";
import { addListener } from "./adapters/redisPubSub";
import { WsEventRouter } from "./wsRouting";
import type { WebSocketTicketIdentity } from "./wsTicket";

const router = new WsEventRouter();

function messageToString(message: string | Buffer): string {
  return typeof message === "string" ? message : message.toString("utf8");
}

export const websocket = {
  open(ws: ServerWebSocket<WebSocketTicketIdentity>) {
    router.open(ws);
  },
  close(ws: ServerWebSocket<WebSocketTicketIdentity>) {
    router.close(ws);
  },
  message(
    ws: ServerWebSocket<WebSocketTicketIdentity>,
    message: string | Buffer,
  ) {
    router.handleClientMessage(ws, messageToString(message));
  },
};

// Redis pub/sub fans every event to every API process; this process routes each
// event only to its locally-connected sockets that declared interest.
addListener((message) => {
  router.routeServerEvent(message);
});
