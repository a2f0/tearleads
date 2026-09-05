import type { RequestFailure } from "@tearleads/api-client";

/** A complete current transport failure for focused client/runtime tests. */
export function createMockRequestFailure(
  input: Pick<RequestFailure, "message"> &
    Partial<Omit<RequestFailure, "message" | "ok">>,
): RequestFailure {
  return {
    kind: input.status == null ? "network" : "http",
    method: "POST",
    path: "mock-request",
    report: () => {},
    status: null,
    statusText: "",
    ...input,
    ok: false,
  };
}
