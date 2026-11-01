import { expect, test } from "bun:test";
import type { ApiNetworkFailureDetails } from "@tearleads/api-client";
import { quietLogger } from "../test/helpers/clientTestSupport";
import { createMemoryBlobStore } from "./data/blobs/memoryBlobStore";
import { Tearleads } from "./Tearleads";

test("requests that get no response reach network-failure subscribers until they unsubscribe", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const tearleads = new Tearleads({
    apiBaseUrl: "https://api.example.test",
    blobStoreFactory: () => createMemoryBlobStore(),
    identity: { signingFingerprint: "alice" },
    logger: quietLogger,
  });
  const failures: ApiNetworkFailureDetails[] = [];
  try {
    const unsubscribe = tearleads.subscribeApiNetworkFailures((details) =>
      failures.push(details),
    );
    await tearleads.session.listSessions().catch(() => undefined);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      method: "GET",
      pathTemplate: "/auth/sessions",
      errorMessage: "Failed to fetch",
    });

    unsubscribe();
    await tearleads.session.listSessions().catch(() => undefined);
    expect(failures).toHaveLength(1);
  } finally {
    tearleads.dispose();
    globalThis.fetch = previousFetch;
  }
});
