import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createWorkflowInputFixture } from "../../../test/helpers/internalRuntimeFixtures";
import type { SecurityIncidentContext } from "../../data/securityIncidents";
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
