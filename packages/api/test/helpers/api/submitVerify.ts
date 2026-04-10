import { routeApp } from "../../../src/routeApp";

export async function submitVerify(
  fingerprint: string,
  signature: Uint8Array,
): Promise<Response> {
  return routeApp.request("/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fingerprint,
      signature: Array.from(signature),
    }),
  });
}
