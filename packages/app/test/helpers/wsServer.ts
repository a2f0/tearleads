import { setWsUrl } from "../../src/events/EventsProvider";

const server = Bun.serve({
  port: 0,
  fetch(req, srv) {
    srv.upgrade(req);
    return undefined;
  },
  websocket: { message() {} },
});

setWsUrl(`ws://localhost:${server.port}`);
