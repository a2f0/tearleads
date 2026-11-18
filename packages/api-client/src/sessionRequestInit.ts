import { hasHeader } from "./requestInternals";
import type { HttpMethod, RequestBody, RequestResultOptions } from "./types";

export function sessionRequestInit(
  method: HttpMethod,
  body: RequestBody | undefined,
  options: RequestResultOptions,
  authToken: string | null,
) {
  const headers = {
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(typeof body === "string" && !hasHeader(options.headers, "Content-Type")
      ? { "Content-Type": "application/json" }
      : {}),
    ...options.headers,
  };
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  if (body !== undefined) {
    init.body = body;
    if (body instanceof ReadableStream) init.duplex = "half";
  }
  return { headers, init };
}
