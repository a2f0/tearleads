import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
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
        apiClient: createMockApiClient({
          createDocument: async () => null,
          createDocumentResult: async () => ({
            kind: "http",
            method: "POST",
            path: "/documents",
            statusText: "Conflict",
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
        }),
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

test("create conflict adoption rejects a create signed by another member", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const foreign = await createAuthor({
    organizationId: author.organizationId,
    userId: "user-2",
  });
  const keyPair = generateKemSeedAndKeyPair();
  const containerScope = {
    containerId: "shared-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
  };
  const projection = await createContainerWriterProjectionFixture({
    ...containerScope,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  // The same container as seen by the other member, who holds write access.
  const foreignProjection = await createContainerWriterProjectionFixture({
    ...containerScope,
    signerKeyFingerprint: foreign.author.signerKeyFingerprint,
    signerPrivateKey: foreign.author.signerPrivateKey,
    userId: foreign.author.signerUserId,
  });
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const { close, execSql } = await createTestExecSql(
    "reject-foreign-signer-document-adoption",
  );
  // The other member's device has its own database and checkpoints.
  const foreignDevice = await createTestExecSql(
    "reject-foreign-signer-document-adoption-foreign-device",
  );

  try {
    // Another member with write access committed a document under the stable
    // id this user minted for its own pending create.
    const foreignPlan = await buildMaterializedDocumentCreatePlan({
      author: foreign.author,
      containerProjection: foreignProjection,
      documentId: "document-stable",
      execSql: foreignDevice.execSql,
      resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
        encapsulationPublicKey: keyPair.publicKey,
        signingKeyFingerprint: foreign.author.signerKeyFingerprint,
        signingPublicKey: foreign.signingPublicKey,
        userId: foreign.author.signerUserId,
      }),
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
        apiClient: createMockApiClient({
          createDocument: async () => null,
          createDocumentResult: async () => ({
            kind: "http",
            method: "POST",
            path: "/documents",
            statusText: "Conflict",
            code: DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists,
            message:
              "POST /documents: 409 Conflict: Document manifest already exists",
            ok: false as const,
            report: () => undefined,
            status: 409,
          }),
          getContainerWriterProjection: async () => projection,
          getDocumentWriterProjection: async () => foreignDocument,
          primeDocumentWriterProjection: () => {
            primed = true;
          },
        }),
        author,
        containerId: projection.containerId,
        documentId: "document-stable",
        execSql,
        expectedOrganizationId: projection.organizationId,
        resolveProjectionUserKey,
        signedAt: "2026-04-27T00:00:00.000Z",
        targetSecretKey: keyPair.secretKey,
      }),
    ).rejects.toMatchObject({
      code: "signer_mismatch",
      name: "KeyingVerificationError",
    });
    expect(primed).toBe(false);
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "document",
        author.organizationId,
        "document-stable",
      ),
    ).resolves.toBeNull();
  } finally {
    foreignDevice.close();
    close();
  }
});

test("create conflict adoption follows the head chain, not a spliced genesis", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const foreign = await createAuthor({
    organizationId: author.organizationId,
    userId: "user-2",
  });
  const keyPair = generateKemSeedAndKeyPair();
  const containerScope = {
    containerId: "shared-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
  };
  const projection = await createContainerWriterProjectionFixture({
    ...containerScope,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const foreignProjection = await createContainerWriterProjectionFixture({
    ...containerScope,
    signerKeyFingerprint: foreign.author.signerKeyFingerprint,
    signerPrivateKey: foreign.author.signerPrivateKey,
    userId: foreign.author.signerUserId,
  });
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const { close, execSql } = await createTestExecSql(
    "reject-spliced-genesis-document-adoption",
  );
  const foreignDevice = await createTestExecSql(
    "reject-spliced-genesis-document-adoption-foreign-device",
  );
  const scratchDevice = await createTestExecSql(
    "reject-spliced-genesis-document-adoption-scratch-device",
  );

  try {
    // The foreign member's document occupies the stable id.
    const foreignPlan = await buildMaterializedDocumentCreatePlan({
      author: foreign.author,
      containerProjection: foreignProjection,
      documentId: "document-stable",
      execSql: foreignDevice.execSql,
      resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
        encapsulationPublicKey: keyPair.publicKey,
        signingKeyFingerprint: foreign.author.signerKeyFingerprint,
        signingPublicKey: foreign.signingPublicKey,
        userId: foreign.author.signerUserId,
      }),
      signedAt: "2026-04-27T00:00:00.000Z",
      targetSecretKey: keyPair.secretKey,
    });
    const foreignDocument = documentWriterProjectionFromCreateResponse({
      containerProjection: foreignProjection,
      response: await createResponseFromRequest(foreignPlan.plan.request),
    });
    // A genesis this user really signed, for a different document.
    const otherPlan = await buildMaterializedDocumentCreatePlan({
      author,
      containerProjection: projection,
      documentId: "document-other",
      execSql: scratchDevice.execSql,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:00.000Z",
      targetSecretKey: keyPair.secretKey,
    });
    const otherDocument = documentWriterProjectionFromCreateResponse({
      containerProjection: projection,
      response: await createResponseFromRequest(otherPlan.plan.request),
    });
    // A dishonest server presents the foreign head as a successor of the
    // user's own genesis for the other document.
    const splicedHead = {
      ...foreignDocument.documentManifest,
      manifest: {
        ...foreignDocument.documentManifest.manifest,
        previousManifestHash: otherDocument.documentManifest.manifestHash,
      },
    };
    const splicedDocument = {
      ...foreignDocument,
      documentManifest: splicedHead,
      documentManifestHistory: [otherDocument.documentManifest],
    };
    let primed = false;

    await expect(
      createRemoteDocument({
        apiClient: createMockApiClient({
          createDocument: async () => null,
          createDocumentResult: async () => ({
            kind: "http",
            method: "POST",
            path: "/documents",
            statusText: "Conflict",
            code: DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists,
            message:
              "POST /documents: 409 Conflict: Document manifest already exists",
            ok: false as const,
            report: () => undefined,
            status: 409,
          }),
          getContainerWriterProjection: async () => projection,
          getDocumentWriterProjection: async () => splicedDocument,
          primeDocumentWriterProjection: () => {
            primed = true;
          },
        }),
        author,
        containerId: projection.containerId,
        documentId: "document-stable",
        execSql,
        expectedOrganizationId: projection.organizationId,
        resolveProjectionUserKey,
        signedAt: "2026-04-27T00:00:00.000Z",
        targetSecretKey: keyPair.secretKey,
      }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      name: "KeyingVerificationError",
    });
    expect(primed).toBe(false);
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "document",
        author.organizationId,
        "document-stable",
      ),
    ).resolves.toBeNull();
  } finally {
    scratchDevice.close();
    foreignDevice.close();
    close();
  }
});
