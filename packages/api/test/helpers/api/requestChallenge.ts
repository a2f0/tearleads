import { app } from "../../../src/index";

export async function requestChallenge(fingerprint: string): Promise<Response> {
  return app.request("/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint }),
  });
}
