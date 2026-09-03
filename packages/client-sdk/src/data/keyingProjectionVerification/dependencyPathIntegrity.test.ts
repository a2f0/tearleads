import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createContainerRevokeManifestFixture,
  createParentProjection,
} from "../../../test/helpers/containerFixtures";
import { createResponse } from "../../../test/helpers/documentFixtures";
import { createLinkSetResponseFromRequest } from "../../../test/helpers/documentResponseFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { buildMaterializedDocumentCreatePlan } from "../../workflows/documents/create";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../../workflows/documents/linkSet";
import { verifyDocumentWriterProjection } from "../keyingProjectionVerification";
import { enforceAccessManifestCheckpoints } from "./accessManifestCheckpointEnforcement";

// Dependency container paths authorize document link events. A compromised API
// controls their order and their age, so two things must hold: a served path is
// a genuine root-to-leaf ancestor chain, and a head event this client has not
// seen before cannot lean on container evidence older than what the client has
// already checkpointed for that container.

const REVOKED_USER_ID = "revoked-writer";

async function createScenario() {
  const revokedKem = generateKemSeedAndKeyPair();
  const revokedSigning = generateSigningSeedAndKeyPair();
  const revokedFingerprint = await toFingerprint(revokedKem.publicKey);
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "write",
      publicKey: revokedKem.publicKey,
      recipientKeyEpochId: `user:${REVOKED_USER_ID}:encapsulation:${revokedFingerprint}`,
      userId: REVOKED_USER_ID,
    },
  });
  const other = await createContainerWriterProjectionFixture({
    containerId: "other-root-container",
    encapsulationPublicKey: parent.encapsulationPublicKey,
    organizationId: parent.projection.organizationId,
    signerKeyFingerprint: parent.author.signerKeyFingerprint,
    signerPrivateKey: parent.author.signerPrivateKey,
    userId: parent.userId,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: parent.projection,
    documentId: "document-dependency-path-integrity",
    targetSecretKey: parent.secretKey,
    trustedLocalProjection: true,
  });
  const createResponseBody = createResponse(created.plan);
  const initialProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [parent.projection],
    contentKeyBundle: createResponseBody.contentKeyBundle,
    documentId: createResponseBody.id,
    documentKekTargets: createResponseBody.documentKekTargets,
    documentManifest: createResponseBody.accessManifest,
    documentManifestHistory: [],
    documentManifestContainerPaths: [[...parent.projection.path]],
    documentContainerManifestHistory: [],
  };
  const resolveUserKey = async (userId: string) => {
    if (userId === parent.userId) {
      return createTestTrustedUserIdentity({
        encapsulationPublicKey: parent.encapsulationPublicKey,
        signingKeyFingerprint: parent.author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
        userId,
      });
    }
    if (userId === REVOKED_USER_ID) {
      return createTestTrustedUserIdentity({
        encapsulationPublicKey: revokedKem.publicKey,
        signingKeyFingerprint: "revoked-writer-signing-fingerprint",
        signingPublicKey: revokedSigning.signingPublicKey,
        userId,
      });
    }
    return null;
  };
  return { initialProjection, other, parent, resolveUserKey };
}

async function linkedHeadProjection(
  scenario: Awaited<ReturnType<typeof createScenario>>,
): Promise<DocumentWriterProjectionResponse> {
  const { initialProjection, other, parent } = scenario;
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author: parent.author,
    operation: "link",
    targetContainerProjection: other,
    targetSecretKey: parent.secretKey,
    trustedLocalProjection: true,
    writerProjection: initialProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    initialProjection.documentId,
    linked.plan.request,
  );
  return {
    ...initialProjection,
    authorizingContainerPaths: [other],
    contentKeyBundle: linkResponse.contentKeyBundle,
    documentKekTargets: linkResponse.documentKekTargets,
    documentManifest: linkResponse.accessManifest,
    documentManifestHistory: [initialProjection.documentManifest],
    documentManifestContainerPaths: [
      [...parent.projection.path],
      [...other.path],
    ],
  };
}

test("a dependency path must be a root-to-leaf ancestor chain", async () => {
  const scenario = await createScenario();
  const [parentRoot] = scenario.parent.projection.path;
  const [otherRoot] = scenario.other.path;
  if (!parentRoot || !otherRoot) {
    throw new Error("Expected root manifests for both containers");
  }
  // The server prefixes the document's container with an unrelated root whose
  // grants would otherwise count toward access on the leaf.
  const projection: DocumentWriterProjectionResponse = {
    ...scenario.initialProjection,
    documentManifestContainerPaths: [[otherRoot, parentRoot]],
  };
  const { close, execSql } = await createTestExecSql(
    "dependency-path-not-ancestor-chain",
  );
  try {
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection,
        resolveUserKey: scenario.resolveUserKey,
      }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      message: expect.stringContaining("parent container"),
    });
  } finally {
    close();
  }
});

test("an unseen head cannot cite container evidence behind the local checkpoint", async () => {
  const scenario = await createScenario();
  const { parent } = scenario;
  const { close, execSql } = await createTestExecSql(
    "dependency-path-behind-checkpoint",
  );
  try {
    // The client has seen the document at its first head and the container at
    // its first manifest.
    await verifyDocumentWriterProjection({
      execSql,
      projection: scenario.initialProjection,
      resolveUserKey: scenario.resolveUserKey,
    });
    const linkedHead = await linkedHeadProjection(scenario);

    // A new head citing the container's current manifest is fine.
    await verifyDocumentWriterProjection({
      execSql,
      projection: linkedHead,
      resolveUserKey: scenario.resolveUserKey,
    });

    // The container then revokes the writer, and the client checkpoints that
    // rotation. A further head that still leans on the pre-revocation manifest
    // for its authorization is exactly what a revoked writer plus a compromised
    // server would produce.
    const [firstManifest] = parent.projection.path;
    if (!firstManifest) {
      throw new Error("Expected the container's initial manifest");
    }
    const rotatedKeyEpochId = await computeContainerKekMaterialId({
      containerId: parent.parentKekState.containerId,
      keyEpoch: 2,
      keyMaterial: crypto.getRandomValues(new Uint8Array(32)),
    });
    const revokeManifest = await createContainerRevokeManifestFixture({
      author: parent.author,
      containerId: parent.parentKekState.containerId,
      containerKeyEpochId: rotatedKeyEpochId,
      eventId: "dependency-path-container-revoke",
      keyringHash: "1".repeat(64),
      organizationId: parent.projection.organizationId,
      predecessorBridgeHash: "2".repeat(64),
      previousManifest:
        firstManifest as unknown as VerifiedContainerAccessManifest,
      subjectId: REVOKED_USER_ID,
      subjectType: "user",
      signingPublicKey: parent.signingPublicKey,
    });
    await enforceAccessManifestCheckpoints({
      execSql,
      organizationId: parent.projection.organizationId,
      policies: [],
      verifiedHeads: [revokeManifest],
      verifiedManifests: [
        firstManifest as unknown as VerifiedContainerAccessManifest,
        revokeManifest,
      ],
    });

    // The plan itself is authored with every linked container's key path; the
    // served projection below is what a compromised server shows the victim.
    const unlinkedAgain = await buildMaterializedDocumentLinkSetMutationPlan({
      author: parent.author,
      operation: "unlink",
      targetContainerProjection: scenario.other,
      targetSecretKey: parent.secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        ...linkedHead,
        authorizingContainerPaths: [parent.projection, scenario.other],
      },
    });
    const unlinkResponse = await createLinkSetResponseFromRequest(
      linkedHead.documentId,
      unlinkedAgain.plan.request,
    );
    const staleAuthorityHead: DocumentWriterProjectionResponse = {
      ...linkedHead,
      authorizingContainerPaths: [scenario.other],
      contentKeyBundle: unlinkResponse.contentKeyBundle,
      documentKekTargets: unlinkResponse.documentKekTargets,
      documentManifest: unlinkResponse.accessManifest,
      // Newest predecessor first, as the API serves it.
      documentManifestHistory: [
        linkedHead.documentManifest,
        scenario.initialProjection.documentManifest,
      ],
    };

    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection: staleAuthorityHead,
        resolveUserKey: scenario.resolveUserKey,
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("behind the local checkpoint"),
    });
  } finally {
    close();
  }
});
