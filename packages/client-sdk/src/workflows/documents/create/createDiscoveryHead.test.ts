import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createResponseFromRequest,
} from "../../../../test/helpers/data/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/data/trustedUserIdentity";
import { createRemoteDocumentForTest as createRemoteDocument } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import { DocumentDiscoveryEvidenceRepository } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { documentContainerProjectionTables } from "../../../data/sqlite/schema/documentProjectionSchema";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import { createDiscoveredDocumentVerifier } from "../../container-contents/documentDiscovery/documentDiscoveryEvidence";

const DOCUMENT_ID = "document-created-here";

/** Creates one note through the remote create workflow. */
async function createNote(
  execSql: ExecSql,
  respond: (response: DocumentCreateResponse) => DocumentCreateResponse = (
    response,
  ) => response,
) {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "created-here-folder",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const created = await createRemoteDocument({
    apiClient: createMockApiClient({
      createDocument: async (request) =>
        respond(await createResponseFromRequest(request)),
      getContainerWriterProjection: async (containerId) =>
        containerId === projection.containerId ? projection : null,
      primeDocumentWriterProjection: () => undefined,
    }),
    author,
    containerId: projection.containerId,
    documentId: DOCUMENT_ID,
    eventId: "event-created-here",
    execSql,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: keyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    signedAt: "2026-11-26T00:00:00.000Z",
    targetSecretKey: keyPair.secretKey,
  });
  return { author, containerId: projection.containerId, created };
}

test("a listing names a note this device created without reading its head", async () => {
  const { close, execSql } = await createTestExecSql("created-discovery-head");
  try {
    const { author, containerId, created } = await createNote(execSql);
    if (!created?.plan) throw new Error("Expected a fresh create");
    const { manifestHash } = created.plan;
    const store = new DocumentDiscoveryEvidenceRepository(execSql);

    let headReads = 0;
    const verify = createDiscoveredDocumentVerifier(
      author.organizationId,
      async () => {
        headReads += 1;
        return null;
      },
      async () => 1,
      store,
    );
    const result = await verify(
      [
        {
          accessEpoch: 1,
          accessStateHash: manifestHash,
          containerId,
          createdAt: "2026-11-26T00:00:00.000Z",
          documentId: DOCUMENT_ID,
          // Listing fields are untrusted hints; only the signed head names
          // links.
          linkedContainerIds: ["forged-container"],
          listedContainerIds: [containerId],
        },
      ],
      [containerId],
      await store.begin(),
    );

    expect(headReads).toBe(0);
    expect(result.inputs).toEqual([
      expect.objectContaining({
        accessStateHash: manifestHash,
        containerId,
        documentId: DOCUMENT_ID,
        linkedContainerIds: [containerId],
      }),
    ]);
    expect(await result.commit()).toBe(true);
  } finally {
    close();
  }
});

test("a create whose acknowledgement names another head seeds nothing", async () => {
  const { close, execSql } = await createTestExecSql(
    "created-discovery-head-mismatch",
  );
  try {
    await expect(
      createNote(execSql, (response) => ({
        ...response,
        manifestHash: "0".repeat(64),
      })),
    ).rejects.toThrow();
    await ensureSqlTables(execSql, documentContainerProjectionTables);
    expect(
      await execSql("SELECT COUNT(*) AS count FROM document_discovery_heads"),
    ).toEqual([{ count: 0 }]);
  } finally {
    close();
  }
});
