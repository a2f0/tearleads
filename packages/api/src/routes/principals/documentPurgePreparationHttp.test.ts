import { expect, spyOn, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  documents,
  principalHistoryIndexNodes,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import { DocumentPurgeRequestSchema } from "@tearleads/validators/request";
import { and, eq } from "drizzle-orm";
import { startPrincipalHistoryHttpProbe } from "../../../test/helpers/principalHistoryHttpProbe";
import { createLongPurgeHistoryFixture } from "../../../test/helpers/principalPurgeHistory";
import { clearAccessManifestVerificationMarkers } from "../../../test/helpers/verificationMarkers";
import { clearProjectionDirectoryBindingsCache } from "../../workflows/principals/projectionDirectoryBindings";

async function discardVerificationHints() {
  await db.delete(principalHistoryProgress);
  await db.delete(principalHistoryIndexNodes);
  clearPrincipalPolicySignatureCaches();
  clearProjectionDirectoryBindingsCache();
  await clearAccessManifestVerificationMarkers();
}

for (const versions of [64, 128]) {
  test(`API client completes cold purge and proof preparation at ${versions} versions`, async () => {
    const fixture = await createLongPurgeHistoryFixture(versions);
    const server = startPrincipalHistoryHttpProbe();
    const client = new ApiClient(server.url.toString());
    client.setAuthToken(fixture.owner.token);
    const authored = DocumentPurgeRequestSchema.parse(
      JSON.parse(fixture.request),
    );
    const requests: { method: string; status: number; body: unknown }[] = [];
    const originalFetch = globalThis.fetch;
    const observe: typeof fetch = Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        const response = await originalFetch(input, init);
        if (
          url.origin === server.url.origin &&
          url.pathname.endsWith("/purge")
        ) {
          if (response.status === 202 && init?.method === "POST") {
            expect(
              await db
                .select({ id: documents.id })
                .from(documents)
                .where(eq(documents.id, fixture.documentId)),
            ).toHaveLength(1);
            expect(
              await db
                .select({ id: accessEvents.id })
                .from(accessEvents)
                .where(
                  and(
                    eq(accessEvents.objectId, fixture.documentId),
                    eq(accessEvents.eventType, "document.purge"),
                  ),
                ),
            ).toHaveLength(0);
          }
          requests.push({
            method: init?.method ?? "GET",
            status: response.status,
            body: init?.body,
          });
        }
        return response;
      },
      { preconnect: originalFetch.preconnect },
    );
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(observe);
    try {
      await discardVerificationHints();
      const purged = await client.purgeDocument(fixture.documentId, authored);
      expect(purged?.documentId).toBe(fixture.documentId);
      const writes = requests.filter(({ method }) => method === "POST");
      expect(writes.map(({ status }) => status)).toContain(202);
      expect(writes.at(-1)?.status).toBe(200);
      expect(
        writes.every(({ body }) => body === JSON.stringify(authored)),
      ).toBe(true);

      await discardVerificationHints();
      const proof = await client.getDocumentPurgeProof(fixture.documentId);
      expect(proof?.purgeEvent.eventHash).toBe(purged?.purgeEvent.eventHash);
      const reads = requests.filter(({ method }) => method === "GET");
      expect(reads.map(({ status }) => status)).toContain(202);
      expect(reads.at(-1)?.status).toBe(200);
      expect(server.metrics.deadlineFailures).toBe(0);
      expect(server.metrics.maximumResponseBytes).toBeLessThan(90_000);
      expect(server.metrics.maximumDatabaseStatementsPerRequest).toBeLessThan(
        512,
      );
    } finally {
      fetchMock.mockRestore();
      await server.stop();
    }
  }, 30_000);
}
