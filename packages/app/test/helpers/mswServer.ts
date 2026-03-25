import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

export const server = setupServer(
  http.post("http://localhost:3001/auth/register", () => {
    const challenge = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return HttpResponse.json({
      message: "ok",
      userId: crypto.randomUUID(),
      challenge,
    });
  }),
);
