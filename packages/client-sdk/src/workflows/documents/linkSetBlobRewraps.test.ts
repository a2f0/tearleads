import { expect, test } from "bun:test";
import {
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  computeDocumentContentKeyTargetHash,
  normalizeDocumentAccessEventBody,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type {
  BlobAttachmentSummary,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydration";
import { createLinkSetResponseFromRequest } from "../../../test/helpers/documentFixtures";
import { contentKeyTargetReference } from "../../data/documents/blob/shared/readers";
import { deriveDocumentTargetFromProjection } from "../../data/documents/shared/projection";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../data/keyingCanonicalJson";
import { decryptDocumentAttachmentBlob } from "../blobs/decrypt";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import { relinkRemoteDocument } from "./linkSetRemote";

async function currentBinding(
  binding: BlobAttachmentSummary,
  projection: DocumentWriterProjectionResponse,
  targets: BlobAttachmentSummary["contentKeyBundle"]["targets"],
): Promise<BlobAttachmentSummary> {
  const references = targets.map(contentKeyTargetReference);
  const targetHash = await computeBlobContentKeyTargetHash(references);
  const current = {
    ...binding.blobKekTargets,
    documentManifestHashes: [projection.documentManifest.manifestHash],
    linkedContainerManifestHashes: references
      .map((target) => target.containerManifestHash)
      .sort(),
    linkedContainerKeyEpochIds: references
      .map((target) => target.containerKeyEpochId)
      .sort(),
    targets: references.map((target) => ({ ...target })),
    blobKeyTargetHash: targetHash,
  };
  const {
    targets: _targets,
    blobAccessManifestHash: _oldHash,
    ...manifest
  } = current;
  return {
    ...binding,
    blobKekTargets: {
      ...current,
      blobAccessManifestHash: await computeBlobAccessManifestHash({
        version: 1,
        ...manifest,
      }),
    },
    contentKeyBundle: { ...binding.contentKeyBundle, targetHash, targets },
  };
}

test("a signed link carries attachment keys usable with only the destination KEK", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const identity = await fixture.resolveProjectionUserKey(
    fixture.author.signerUserId,
  );
  if (!identity) throw new Error("Expected fixture identity");
  const target = await createContainerWriterProjectionFixture({
    containerId: "independent-destination",
    encapsulationPublicKey: identity.encapsulationPublicKey,
    organizationId: fixture.author.organizationId,
    signerKeyFingerprint: fixture.author.signerKeyFingerprint,
    signerPrivateKey: fixture.author.signerPrivateKey,
    userId: fixture.author.signerUserId,
  });
  const binding = createFixtureBinding(fixture);
  const primed: DocumentWriterProjectionResponse[] = [];
  const result = await relinkRemoteDocument({
    apiClient: createMockApiClient({
      getContainerWriterProjection: async () => target,
      getDocumentWriterProjection: async () => fixture.writerProjection,
      listDocumentAttachments: async () => [binding],
      getBlobBytes: async (blobId) =>
        createBlobBytesResponse({
          blobId,
          encryptedBytes: fixture.stagedBlob.encryptedBytes,
          sha256: fixture.stagedBlob.sha256,
        }),
      linkDocument: async (documentId, request) =>
        createLinkSetResponseFromRequest(documentId, request),
      primeDocumentWriterProjection: (_id, projection) => {
        primed.push(projection);
      },
    }),
    author: fixture.author,
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    operation: "link",
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetContainerId: target.containerId,
    targetSecretKey: fixture.secretKey,
  });
  if (!result || !primed[0])
    throw new Error("Expected signed link and primed projection");
  const body = normalizeDocumentAccessEventBody(
    readCanonicalJson(result.plan.request.body, "link body"),
  );
  const rewrap = body.blobRewraps[0];
  expect(body.blobRewraps).toHaveLength(1);
  if (!rewrap) throw new Error("Expected attachment rewrap");
  expect(rewrap.targets).toHaveLength(2);
  expect(
    rewrap.targets.find(
      (envelope) =>
        envelope.containerId ===
        binding.contentKeyBundle.targets[0]?.containerId,
    )?.wrappedKey,
  ).toBe(binding.contentKeyBundle.targets[0]?.wrappedKey);
  const writerProjection = {
    ...primed[0],
    authorizingContainerPaths: [target],
  };
  const wrappedBinding = await currentBinding(
    binding,
    writerProjection,
    rewrap.targets.map((envelope) => ({
      ...envelope,
      wrappingMetadata: readCanonicalRecord(
        envelope.wrappingMetadata,
        "rewrap metadata",
      ),
    })),
  );
  const cold = await createTestExecSql("cold-attachment-destination");
  try {
    const input = {
      binding: wrappedBinding,
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedDocumentId: fixture.writerProjection.documentId,
      expectedSlotId: fixture.attachment.slotId,
      execSql: cold.execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection,
    };
    await expect(
      decryptDocumentAttachmentBlob({
        ...input,
        binding: {
          ...wrappedBinding,
          contentKeyBundle: binding.contentKeyBundle,
        },
      }),
    ).rejects.toThrow("could not be unwrapped");
    const bytes = await decryptDocumentAttachmentBlob(input);
    expect(Array.from(bytes)).toEqual(Array.from(fixture.bytes));
  } finally {
    cold.close();
  }
});

test("a cold device reads retained blob wraps after a signed container rekey", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const previousProjection =
    fixture.writerProjection.authorizingContainerPaths[0];
  if (!previousProjection) throw new Error("Expected container path");
  const rotated = await buildMaterializedContainerRekeyPlan({
    author: fixture.author,
    execSql: fixture.execSql,
    previousProjection,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });
  const target = deriveDocumentTargetFromProjection(rotated.writerProjection);
  const writerProjection: DocumentWriterProjectionResponse = {
    ...fixture.writerProjection,
    authorizingContainerPaths: [rotated.writerProjection],
    contentKeyBundleStale: true,
    documentKekTargets: {
      ...fixture.writerProjection.documentKekTargets,
      documentKeyTargetHash: await computeDocumentContentKeyTargetHash([
        target,
      ]),
      linkedContainerManifestHashes: [target.containerManifestHash],
      linkedContainerKeyEpochIds: [target.containerKeyEpochId],
      targets: [{ ...target }],
    },
  };
  const binding = createFixtureBinding(fixture);
  const oldTarget = binding.contentKeyBundle.targets[0];
  if (!oldTarget) throw new Error("Expected blob envelope");
  const current = await currentBinding(binding, writerProjection, [
    { ...oldTarget, ...target },
  ]);
  const cold = await createTestExecSql("cold-rekeyed-attachment");
  try {
    const bytes = await decryptDocumentAttachmentBlob({
      binding: { ...current, contentKeyBundle: binding.contentKeyBundle },
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedDocumentId: fixture.writerProjection.documentId,
      expectedSlotId: fixture.attachment.slotId,
      execSql: cold.execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection,
    });
    expect(Array.from(bytes)).toEqual(Array.from(fixture.bytes));
    expect(current.blobKekTargets.blobKeyTargetHash).not.toBe(
      binding.contentKeyBundle.targetHash,
    );
  } finally {
    cold.close();
  }
});
