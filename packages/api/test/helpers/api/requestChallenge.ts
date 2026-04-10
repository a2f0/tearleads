import { routeApp } from "../../../src/routeApp";

export async function requestChallenge(fingerprint: string): Promise<Response> {
  return routeApp.request("/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint }),
  });
}
