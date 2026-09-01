import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import { createApiUserIdentitySource } from "./apiAdapter";

type IdentityApi = Pick<
  ApiClient,
  "evictUserIdentity" | "getUserIdentity" | "getUserIdentityRequestFailure"
>;

function failedIdentityApi(kind: "http" | "json" | "shape"): IdentityApi {
  return {
    evictUserIdentity: () => undefined,
    getUserIdentity: async () => null,
    getUserIdentityRequestFailure: () => ({
      kind,
      message: "request failed",
      method: "GET",
      ok: false,
      path: "/auth/user-identity/user-1",
      report: () => undefined,
      status: kind === "http" ? 404 : 200,
      statusText: kind === "http" ? "Not Found" : "OK",
    }),
  };
}

test("identity API adapter promotes malformed successful responses to hard failures", async () => {
  for (const kind of ["json", "shape"] as const) {
    const source = createApiUserIdentitySource(failedIdentityApi(kind));
    await expect(source.load("user-1")).rejects.toMatchObject({
      code: "invalid_shape",
    });
  }
});

test("identity API adapter retains an ordinary not-found result", async () => {
  const source = createApiUserIdentitySource(failedIdentityApi("http"));
  await expect(source.load("user-1")).resolves.toBeNull();
});

test("identity API adapter delegates scoped cache invalidation", () => {
  const evicted: string[] = [];
  const source = createApiUserIdentitySource({
    ...failedIdentityApi("http"),
    evictUserIdentity: (userId) => evicted.push(userId),
  });

  source.invalidate("user-1");

  expect(evicted).toEqual(["user-1"]);
});
