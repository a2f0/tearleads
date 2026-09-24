import { expect, mock, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createWorkflowInputFixture } from "../../../test/helpers/internalRuntimeFixtures";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import type { SecurityIncidentContext } from "../../data/securityIncidents";
import { discoverContainerDocuments } from "./documentDiscovery";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";
import { createDiscoveredDocumentVerifier } from "./documentDiscoveryEvidence";
import {
  createContainerDocumentTombstoneVerifier,
  createDocumentHeadLinkSetLoader,
} from "./documentTombstoneEvidence";
import { createContainerContentsWorkflowRuntime } from "./runtime";

const at = "2026-09-20T00:00:00.000Z";
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440042";

/**
 * The production loader against a real signed document projection: the
 * verification path itself, not a stubbed verifier, decides the verdict.
 */
async function createVerificationHarness(
  serve: (
    projection: DocumentWriterProjectionResponse,
  ) => DocumentWriterProjectionResponse = (projection) => projection,
) {
  const fixture = await createMaterializedSyncFixture({
    documentId: DOCUMENT_ID,
  });
  const database = await createTestExecSql(
    `tombstone-verification-${crypto.randomUUID()}`,
  );
  const incidents: SecurityIncidentContext[] = [];
  const evicted: string[] = [];
  const apiClient = {
    evictDocumentWriterProjection: (documentId: string) => {
      evicted.push(documentId);
    },
    getCurrentPrincipalPolicy: async () => null,
    getDocumentWriterProjectionResult: async () => ({
      data: serve(fixture.writerProjection),
      ok: true as const,
    }),
  };
  const input = createWorkflowInputFixture({
    apiClient: apiClient as never,
    execSql: database.execSql,
    resolveTrustedUserIdentity: fixture.resolveProjectionUserKey,
  });
  const runtime = createContainerContentsWorkflowRuntime({
    ...input,
    util: {
      ...input.util,
      reportSecurityIncident: async (_error, context) => {
        incidents.push(context);
      },
    },
  });
  return {
    store: createDocumentDiscoveryEvidenceStore(database.execSql),
    close: database.close,
    evicted,
    fixture,
    incidents,
    load: createDocumentHeadLinkSetLoader(runtime),
  };
}

test("a real signed head refutes a tombstone for a container it links and verifies one it omits", async () => {
  const harness = await createVerificationHarness();
  try {
    const verify = createContainerDocumentTombstoneVerifier(
      harness.load,
      async () => 1,
    );

    const verdicts = await verify([
      {
        containerId: "materialized-sync-container",
        documentId: DOCUMENT_ID,
        updatedAt: at,
      },
      { containerId: "somewhere-else", documentId: DOCUMENT_ID, updatedAt: at },
    ]);

    expect(harness.evicted).toEqual([DOCUMENT_ID]);
    expect(harness.incidents).toEqual([]);
    expect(verdicts).toEqual([
      {
        kind: "refuted",
        linkedContainerIds: ["materialized-sync-container"],
        tombstone: {
          containerId: "materialized-sync-container",
          documentId: DOCUMENT_ID,
          updatedAt: at,
        },
      },
      {
        kind: "verified",
        tombstone: {
          accessEpoch: 1,
          containerId: "somewhere-else",
          documentId: DOCUMENT_ID,
          linkedContainerIds: ["materialized-sync-container"],
          updatedAt: at,
        },
      },
    ]);
  } finally {
    harness.close();
  }
});

test("a tampered head is no evidence and is reported as a security incident", async () => {
  const harness = await createVerificationHarness((projection) => ({
    ...projection,
    documentManifest: {
      ...projection.documentManifest,
      state: {
        ...projection.documentManifest.state,
        linkedContainerIds: ["attacker-chosen"],
      },
    },
  }));
  try {
    expect(await harness.load(DOCUMENT_ID)).toBeNull();
    expect(harness.incidents).toMatchObject([
      {
        objectId: DOCUMENT_ID,
        objectKind: "document",
        operation: "document.tombstone-evidence",
      },
    ]);
  } finally {
    harness.close();
  }
});

for (const listedContainer of [
  "materialized-sync-container",
  "forged-placement",
]) {
  test(`listing ${listedContainer} uses only signed placement and links`, async () => {
    const harness = await createVerificationHarness();
    try {
      const inputs: unknown[] = [];
      const links: unknown[] = [];
      const summaries = await discoverContainerDocuments({
        ...nullContainerDocumentWatermarks,
        containerId: listedContainer,
        listContainerDocuments: async () => ({
          hasMore: false,
          nextWatermark: null,
          tombstones: [],
          items: [
            {
              id: DOCUMENT_ID,
              currentAccessEpoch: 1,
              currentAccessStateHash: "forged-hash",
              linkedContainerIds: ["forged-placement"],
              createdAt: at,
              updatedAt: at,
              referencedPrincipals: [],
            },
          ],
        }),
        verifyDiscoveredDocuments: createDiscoveredDocumentVerifier(
          harness.load,
          async () => 1,
          harness.store,
        ),
        upsertDiscoveredDocuments: async (values) => {
          inputs.push(...values);
          return values.map((value) => ({
            id: value.documentId,
            documentId: value.documentId,
            containerId: value.containerId,
            title: "document",
            updatedAt: at,
          }));
        },
        replaceDocumentLinksBatch: async (values) => {
          links.push(...values);
        },
      });
      const accepted = listedContainer === "materialized-sync-container";
      expect(summaries).toHaveLength(accepted ? 1 : 0);
      expect(inputs).toEqual(
        accepted
          ? [
              {
                accessEpoch: 1,
                accessStateHash:
                  harness.fixture.writerProjection.documentManifest
                    .manifestHash,
                containerId: listedContainer,
                createdAt: at,
                documentId: DOCUMENT_ID,
                effectiveAccessLevel: undefined,
                linkedContainerIds: ["materialized-sync-container"],
              },
            ]
          : [],
      );
      expect(links).toEqual(
        accepted
          ? [
              {
                documentId: DOCUMENT_ID,
                accessEpoch: 1,
                containerIds: ["materialized-sync-container"],
              },
            ]
          : [],
      );
    } finally {
      harness.close();
    }
  });
}

test("a tampered listing head cannot write placement or advance its watermark", async () => {
  const harness = await createVerificationHarness((projection) => ({
    ...projection,
    documentManifest: {
      ...projection.documentManifest,
      state: {
        ...projection.documentManifest.state,
        linkedContainerIds: ["attacker"],
      },
    },
  }));
  try {
    const persist = mock(async () => []);
    const watermark = mock(async () => {});
    const replaceLinks = mock(async () => {});
    expect(
      await discoverContainerDocuments({
        ...nullContainerDocumentWatermarks,
        containerId: "attacker",
        listContainerDocuments: async () => ({
          hasMore: false,
          nextWatermark: { id: DOCUMENT_ID, updatedAt: at },
          tombstones: [],
          items: [
            {
              id: DOCUMENT_ID,
              currentAccessEpoch: 1,
              currentAccessStateHash: "forged",
              linkedContainerIds: ["attacker"],
              createdAt: at,
              updatedAt: at,
              referencedPrincipals: [],
            },
          ],
        }),
        verifyDiscoveredDocuments: createDiscoveredDocumentVerifier(
          harness.load,
          async () => 1,
          harness.store,
        ),
        upsertDiscoveredDocuments: persist,
        replaceDocumentLinksBatch: replaceLinks,
        saveContainerDocumentWatermark: watermark,
      }),
    ).toBeNull();
    expect(persist).not.toHaveBeenCalled();
    expect(replaceLinks).not.toHaveBeenCalled();
    expect(watermark).toHaveBeenCalledTimes(1);
    expect(await harness.store.hasPending(["attacker"])).toBe(true);
    expect(harness.incidents).toHaveLength(1);
  } finally {
    harness.close();
  }
});

for (const [listingEpoch, localEpoch] of [
  [2, 1],
  [1, 2],
] as const) {
  test(`discovery refuses a signed head behind listing=${listingEpoch}, local=${localEpoch}`, async () => {
    const harness = await createVerificationHarness();
    try {
      const verify = createDiscoveredDocumentVerifier(
        harness.load,
        async () => localEpoch,
        harness.store,
      );
      const result = await verify(
        [
          {
            accessEpoch: listingEpoch,
            accessStateHash: "listing-head",
            containerId: "materialized-sync-container",
            listedContainerIds: ["materialized-sync-container"],
            createdAt: at,
            documentId: DOCUMENT_ID,
            linkedContainerIds: ["materialized-sync-container"],
          },
        ],
        ["materialized-sync-container"],
        await harness.store.begin(),
      );
      expect(result.inputs).toEqual([]);
      expect(await result.commit()).toBe(false);
      expect(harness.incidents).toEqual([]);
    } finally {
      harness.close();
    }
  });
}
