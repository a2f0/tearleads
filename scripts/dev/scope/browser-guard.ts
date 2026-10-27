import { readFileSync } from "node:fs";
import { type IncomingMessage, Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { browserRequestAllowed } from "./browser-policy";

const { ports } = JSON.parse(
  readFileSync(new URL("./pins.json", import.meta.url), "utf8"),
);
const originalEmit = Server.prototype.emit;

// Preload before upstream Express/Vite installs handlers, including proxies and HMR.
Server.prototype.emit = function (event: string | symbol, ...args: unknown[]) {
  if (
    typeof event === "string" &&
    ["request", "upgrade", "checkContinue", "checkExpectation"].includes(event)
  ) {
    const request = args[0] as IncomingMessage;
    if (
      !browserRequestAllowed(
        {
          host: request.headers.host,
          origin: request.headers.origin,
          site: request.headers["sec-fetch-site"]?.toString(),
        },
        request.socket.localPort ?? 0,
        ports.portal,
      )
    ) {
      if (event === "upgrade") {
        (args[1] as Socket).end(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
      } else {
        (args[1] as ServerResponse)
          .writeHead(403)
          .end("Forbidden browser origin");
      }
      return true;
    }
  }
  return originalEmit.call(this, event, ...args);
};
