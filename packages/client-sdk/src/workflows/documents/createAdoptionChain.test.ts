import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
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

const SIGNED_AT = "2026-04-27T00:00:00.000Z";

/**
 * A local user retrying a lost create for `document-stable` against a server
 * that committed another member's document under that id. The server is free
 * to shape the served history; the adoption gate must read only the head's
 * predecessor chain.
 */
async function createConflictFixture(name: string) {
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
  const local = await createTestExecSql(name);
  const foreignDevice = await createTestExecSql(`${name}-foreign-device`);
  const scratchDevice = await createTestExecSql(`${name}-scratch-device`);
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
    signedAt: SIGNED_AT,
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
    signedAt: SIGNED_AT,
    targetSecretKey: keyPair.secretKey,
  });
  const otherDocument = documentWriterProjectionFromCreateResponse({
    containerProjection: projection,
    response: await createResponseFromRequest(otherPlan.plan.request),
  });
  return {
    author,
    close: () => {
      scratchDevice.close();
      foreignDevice.close();
      local.close();
    },
    execSql: local.execSql,
    foreignDocument,
    keyPair,
    otherDocument,
    projection,
    resolveProjectionUserKey,
  };
}

type ConflictFixture = Awaited<ReturnType<typeof createConflictFixture>>;

function withPreviousManifestHash(
  bundle: DocumentWriterProjectionResponse["documentManifest"],
  previousManifestHash: string,
): DocumentWriterProjectionResponse["documentManifest"] {
  return {
    ...bundle,
    manifest: { ...bundle.manifest, previousManifestHash },
  };
}

async function expectAdoptionRefused(
  fixture: ConflictFixture,
  served: DocumentWriterProjectionResponse,
  code: string,
): Promise<void> {
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
        getContainerWriterProjection: async () => fixture.projection,
        getDocumentWriterProjection: async () => served,
        primeDocumentWriterProjection: () => {
          primed = true;
        },
      }),
      author: fixture.author,
      containerId: fixture.projection.containerId,
      documentId: "document-stable",
      execSql: fixture.execSql,
      expectedOrganizationId: fixture.projection.organizationId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      signedAt: SIGNED_AT,
      targetSecretKey: fixture.keyPair.secretKey,
    }),
  ).rejects.toMatchObject({ code, name: "KeyingVerificationError" });
  expect(primed).toBe(false);
  await expect(
    loadAccessManifestCheckpoint(
      fixture.execSql,
      "document",
      fixture.author.organizationId,
      "document-stable",
    ),
  ).resolves.toBeNull();
}

test("create conflict adoption follows the head chain, not a spliced genesis", async () => {
  const fixture = await createConflictFixture("adoption-spliced-genesis");
  try {
    // A dishonest server presents the foreign head as a successor of the
    // user's own genesis for the other document.
    await expectAdoptionRefused(
      fixture,
      {
        ...fixture.foreignDocument,
        documentManifest: withPreviousManifestHash(
          fixture.foreignDocument.documentManifest,
          fixture.otherDocument.documentManifest.manifestHash,
        ),
        documentManifestHistory: [fixture.otherDocument.documentManifest],
      },
      "object_mismatch",
    );
  } finally {
    fixture.close();
  }
});

test("create conflict adoption types a history missing the create event", async () => {
  const fixture = await createConflictFixture("adoption-missing-predecessor");
  try {
    await expectAdoptionRefused(
      fixture,
      {
        ...fixture.foreignDocument,
        documentManifest: withPreviousManifestHash(
          fixture.foreignDocument.documentManifest,
          "missing-predecessor-hash",
        ),
        documentManifestHistory: [],
      },
      "invalid_shape",
    );
  } finally {
    fixture.close();
  }
});

test("create conflict adoption types a cyclic manifest history", async () => {
  const fixture = await createConflictFixture("adoption-cyclic-history");
  try {
    const head = withPreviousManifestHash(
      fixture.foreignDocument.documentManifest,
      fixture.foreignDocument.documentManifest.manifestHash,
    );
    await expectAdoptionRefused(
      fixture,
      {
        ...fixture.foreignDocument,
        documentManifest: head,
        documentManifestHistory: [head],
      },
      "invalid_shape",
    );
  } finally {
    fixture.close();
  }
});
