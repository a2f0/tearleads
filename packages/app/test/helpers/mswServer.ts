import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const server = setupServer(
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
