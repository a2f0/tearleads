import type { RouteRequestBindings } from "../../../src/middleware/session";
import { routeApp } from "../../../src/routeApp";

export async function submitVerify(
  fingerprint: string,
  signature: Uint8Array,
  headers?: HeadersInit,
  bindings?: RouteRequestBindings,
): Promise<Response> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Content-Type", "application/json");

  return routeApp.request(
    "/auth/verify",
    {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        fingerprint,
        signature: Array.from(signature),
      }),
    },
    bindings,
  );
}
