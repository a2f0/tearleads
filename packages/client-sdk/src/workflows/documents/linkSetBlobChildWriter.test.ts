import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydrationFixture";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../test/helpers/containerFixtures";
import {
  createLinkSetResponseFromRequest,
  createResponse,
  writerProjectionEvidence,
} from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { unwrapContainerKekPath } from "../../data/documents/shared/projection";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../containers/child/create";
import { buildMaterializedContainerSharePlan } from "../containers/child/shareMaterialization";
import { buildMaterializedDocumentCreatePlan } from "./create";
import { relinkRemoteDocument } from "./linkSetRemote";

test("a child-only writer relinks an attachment without the parent secret", async () => {
  const root = await createParentProjection();
  const peer = await createAuthor({
    organizationId: root.author.organizationId,
    userId: "child-writer",
  });
  const kem = generateKemSeedAndKeyPair();
  const identity = await createTestTrustedUserIdentity({
    userId: peer.author.signerUserId,
    signingKeyFingerprint: peer.author.signerKeyFingerprint,
    signingPublicKey: peer.signingPublicKey,
    encapsulationPublicKey: kem.publicKey,
  });
  const ownerResolver = createParentProjectionUserKeyResolver(root);
  const resolveProjectionUserKey = async (userId: string) =>
    userId === identity.userId ? identity : ownerResolver(userId);
  const database = await createTestExecSql("child-writer-attachment");
  try {
    const ownerInput = {
      author: root.author,
      execSql: database.execSql,
      resolveProjectionUserKey,
      targetSecretKey: root.secretKey,
    };
    const child = await buildMaterializedContainerCreatePlan({
      ...ownerInput,
      parentProjection: root.projection,
      parentSecretKey: root.secretKey,
      containerId: "shared-child",
    });
    const original = childContainerWriterProjectionFromCreatePlan({
      materializedPlan: child,
      parentProjection: root.projection,
    });
    const shared = await buildMaterializedContainerSharePlan({
      ...ownerInput,
      accessLevel: "write",
      previousProjection: original,
      recipient: {
        subjectType: "user",
        subjectId: peer.author.signerUserId,
        recipientEncapsulationPublicKey: kem.publicKey,
      },
    });
    const response = await createMutationResponseFromRequest(
      shared.plan.request,
      original.containerKeks.at(-1),
    );
    const projection = {
      ...original,
      path: [...root.projection.path, response.accessManifest],
      containerKeks: [
        ...root.projection.containerKeks,
        {
          ...response.containerKek,
          containerManifestHistory: [
            ...response.containerKek.containerManifestHistory,
            ...original.path.slice(-1),
          ],
        },
      ],
    };
    const keys = await unwrapContainerKekPath({
      execSql: database.execSql,
      projection,
      secretKey: kem.secretKey,
      resolveProjectionUserKey,
    });
    expect(keys.has(root.parentKekState.containerKeyEpochId)).toBe(false);
    expect(keys.has(child.plan.containerKeyEpochId)).toBe(true);
    const authorInput = {
      author: peer.author,
      execSql: database.execSql,
      targetSecretKey: kem.secretKey,
      resolveProjectionUserKey,
    };
    const contentKey = crypto.getRandomValues(new Uint8Array(32));
    const document = await buildMaterializedDocumentCreatePlan({
      ...authorInput,
      containerProjection: projection,
      contentKey,
      documentId: crypto.randomUUID(),
    });
    const created = createResponse(document.plan);
    const writerProjection = {
      documentId: created.id,
      documentManifest: created.accessManifest,
      documentKekTargets: created.documentKekTargets,
      contentKeyBundle: created.contentKeyBundle,
      authorizingContainerPaths: [projection],
      ...writerProjectionEvidence([projection], []),
    };
    const destination = await buildMaterializedContainerCreatePlan({
      ...authorInput,
      parentProjection: projection,
      parentSecretKey: kem.secretKey,
      containerId: "child-destination",
    });
    const target = childContainerWriterProjectionFromCreatePlan({
      parentProjection: projection,
      materializedPlan: destination,
    });
    const fixture = await createUploadedAttachmentFixture({
      documentFixture: {
        author: peer.author,
        publicKey: kem.publicKey,
        secretKey: kem.secretKey,
        signingPublicKey: peer.signingPublicKey,
        contentKey,
        projection,
        createResponse: created,
        writerProjection,
        resolveProjectionUserKey,
      },
    });
    try {
      let submitted = false;
      const linked = await relinkRemoteDocument({
        ...authorInput,
        execSql: fixture.execSql,
        documentId: created.id,
        operation: "link",
        targetContainerId: target.containerId,
        apiClient: createMockApiClient({
          getContainerWriterProjection: async () => target,
          getDocumentWriterProjection: async () => writerProjection,
          listDocumentAttachments: async () => [createFixtureBinding(fixture)],
          getBlobBytes: async (blobId) =>
            createBlobBytesResponse({
              blobId,
              encryptedBytes: fixture.stagedBlob.encryptedBytes,
              sha256: fixture.stagedBlob.sha256,
            }),
          linkDocument: async (documentId, request) => {
            submitted = true;
            return createLinkSetResponseFromRequest(documentId, request);
          },
        }),
      });
      expect(linked).not.toBeNull();
      expect(submitted).toBe(true);
    } finally {
      fixture.close();
    }
  } finally {
    database.close();
  }
});
