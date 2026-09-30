import type { RequestFailureKind } from "./types";

/**
 * Only a body that arrived and failed to parse is a malformed response. A
 * connection dropped while the body streams rejects `response.json()` too, but
 * says nothing about what the server sent, so it is a network failure. Every
 * other rejection lands there too, including a misuse such as a body already
 * read; none of them is evidence about the server.
 */
export function responseBodyFailure(
  error: unknown,
  message: string,
): {
  readonly kind: Extract<RequestFailureKind, "json" | "network">;
  readonly message: string;
} {
  return error instanceof SyntaxError
    ? { kind: "json", message: `failed to parse JSON: ${message}` }
    : { kind: "network", message: `failed to read the body: ${message}` };
}
