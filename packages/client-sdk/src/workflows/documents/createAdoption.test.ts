import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  createAuthor,
  createResponseFromRequest,
} from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { loadAccessManifestCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
  documentWriterProjectionFromCreateResponse,
} from "./create";

test("create conflict adoption rejects another container or organization", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projectionFixture = {
    encapsulationPublicKey: keyPair.publicKey,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  };
  const expectedProjection = await createContainerWriterProjectionFixture({
    ...projectionFixture,
    containerId: "expected-container",
    organizationId: author.organizationId,
  });
  const foreignProjection = await createContainerWriterProjectionFixture({
    ...projectionFixture,
    containerId: "expected-container",
    organizationId: "foreign-organization",
  });
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const { close, execSql } = await createTestExecSql(
    "reject-foreign-document-adoption",
  );

  try {
    const foreignPlan = await buildMaterializedDocumentCreatePlan({
      author,
      containerProjection: foreignProjection,
      documentId: "document-stable",
      execSql,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      targetSecretKey: keyPair.secretKey,
    });
    const foreignDocument = documentWriterProjectionFromCreateResponse({
      containerProjection: foreignProjection,
      response: await createResponseFromRequest(foreignPlan.plan.request),
    });
    let primed = false;

    await expect(
      createRemoteDocument({
        apiClient: {
          createDocument: async () => null,
          createDocumentResult: async () => ({
            code: DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists,
            message:
              "POST /documents: 409 Conflict: Document manifest already exists",
            ok: false as const,
            report: () => undefined,
            status: 409,
          }),
          getContainerWriterProjection: async () => expectedProjection,
          getDocumentWriterProjection: async () => foreignDocument,
          primeDocumentWriterProjection: () => {
            primed = true;
          },
        },
        author,
        containerId: expectedProjection.containerId,
        documentId: "document-stable",
        execSql,
        expectedOrganizationId: expectedProjection.organizationId,
        resolveProjectionUserKey,
        signedAt: "2026-04-27T00:00:00.000Z",
        targetSecretKey: keyPair.secretKey,
      }),
    ).rejects.toThrow(
      "Document create conflict belongs to another container or organization",
    );
    expect(primed).toBe(false);
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "document",
        "foreign-organization",
        "document-stable",
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
