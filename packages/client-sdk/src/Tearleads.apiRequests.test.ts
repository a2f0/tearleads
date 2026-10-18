import { expect, test } from "bun:test";
import { ApiRequestMetrics } from "@tearleads/api-client";
import { quietLogger } from "../test/helpers/clientTestSupport";
import { createMemoryBlobStore } from "./data/blobs/memoryBlobStore";
import { Tearleads } from "./Tearleads";

test("request counts survive identity switches and SDK recreation with a shared store", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({ sessions: [] })) as unknown as typeof fetch;
  const metrics = new ApiRequestMetrics();
  const createClient = (signingFingerprint: string) =>
    new Tearleads({
      apiBaseUrl: "https://api.example.test",
      apiRequestMetrics: metrics,
      blobStoreFactory: () => createMemoryBlobStore(),
      identity: { signingFingerprint },
      logger: quietLogger,
    });
  try {
    const first = createClient("alice");
    try {
      await first.session.listSessions();
      expect(metrics.getSnapshot("alice").total).toBe(1);
      await first.identity.setKeyPairs({
        signingFingerprint: "bob",
        signingKeyPair: null,
        encapsulationKeyPair: null,
      });
      await first.session.listSessions();
      expect(metrics.getSnapshot("bob").total).toBe(1);
    } finally {
      first.dispose();
    }
    const restored = createClient("alice");
    try {
      expect(restored.apiRequests.getSnapshot("alice").total).toBe(1);
      await restored.session.listSessions();
      expect(restored.apiRequests.getSnapshot("alice").total).toBe(2);
      expect(restored.apiRequests.getSnapshot("bob").total).toBe(1);
    } finally {
      restored.dispose();
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});
