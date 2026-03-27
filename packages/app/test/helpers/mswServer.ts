import { HttpResponse, http, ws } from "msw";
import { setupServer } from "msw/node";

export const wsUrl = "ws://localhost:3002";

const eventsSocket = ws.link(wsUrl);

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const server = setupServer(
  eventsSocket.addEventListener("connection", () => {
    // Keep the test socket open; individual tests can add behavior later.
  }),
  http.post("http://localhost:3001/auth/register", () => {
    return HttpResponse.json({
      message: "ok",
      userId: crypto.randomUUID(),
      challenge: randomHex(32),
    });
  }),
  http.post("http://localhost:3001/auth/verify", () => {
    return HttpResponse.json({
      authenticated: true,
      token: randomHex(64),
    });
  }),
);

server.listen();

export function resetMockServer() {
  server.resetHandlers();
}
