import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

export const server = setupServer(
  http.post("http://localhost:3001/auth/register", () => {
    return HttpResponse.json({ message: "ok", userId: crypto.randomUUID() });
  }),
);
