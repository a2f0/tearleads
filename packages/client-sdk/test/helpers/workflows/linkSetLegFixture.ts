import {
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type {
  BlobAttachmentSummary,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { contentKeyTargetReference } from "../../../src/data/blobs/attachments/readers";
import { DOCUMENTS_APP_KIND } from "../../../src/data/documents/documentConstants";
import type { DocumentLinkSetMutationFailure } from "../../../src/data/documents/shared/types";
import { ensureDocumentsSchema } from "../../../src/data/persistence/documents/internal/ensureDocumentsSchema";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../../src/data/sqlite/schema/documentAttachmentSchema";
import { documents } from "../../../src/data/sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../src/data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import { buildMaterializedDocumentCreatePlan } from "../../../src/workflows/documents/create";
import {
  createAuthor,
  createResponse,
  writerProjectionEvidence,
} from "../data/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../data/trustedUserIdentity";

/** A created document and a sibling destination for one link or unlink leg. */
export async function linkLegFixture(name: string) {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const fixture = {
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: "reuse-organization",
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  };
  const projection = await createContainerWriterProjectionFixture({
    ...fixture,
    containerId: `${name}-root`,
  });
  const sibling = await createContainerWriterProjectionFixture({
    ...fixture,
    containerId: `${name}-sibling`,
    parentProjection: projection,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: `${name}-document`,
    targetSecretKey: keyPair.secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    ...writerProjectionEvidence([projection], []),
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  return {
    author,
    keyPair,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: keyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    sibling,
    writerProjection,
  };
}

/** The `linkDocumentResult` failure a mock API answers with. */
export function linkSetRefusal(
  documentId: string,
  failure: DocumentLinkSetMutationFailure,
  onReport: () => void = () => {},
) {
  return {
    ...failure,
    kind: "http" as const,
    method: "POST" as const,
    ok: false as const,
    path: `/documents/${documentId}/link`,
    report: onReport,
    statusText: "Conflict",
  };
}

/** `binding` as listed once its blob carries exactly `targets`. */
export async function bindingWithTargets(
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
  const { targets: _targets, blobAccessManifestHash: _old, ...rest } = current;
  return {
    ...binding,
    blobKekTargets: {
      ...current,
      blobAccessManifestHash: await computeBlobAccessManifestHash({
        version: 1,
        ...rest,
      }),
    },
    contentKeyBundle: { ...binding.contentKeyBundle, targetHash, targets },
  };
}

/** What the device holds locally for a server document. */
export type LocalView =
  | "absent"
  | "empty"
  | "held"
  | "detached"
  | "pending"
  | "metadata";

/** Seed one local view of `documentId`; `absent` holds nothing. */
export async function seedLocalView(
  execSql: ExecSql,
  documentId: string,
  view: LocalView,
): Promise<void> {
  if (view === "absent") return;
  await ensureDocumentsSchema(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const localId = `${documentId}-local`;
  const now = new Date().toISOString();
  await db
    .insert(documents)
    .values({
      appKind: view === "metadata" ? "container-metadata" : DOCUMENTS_APP_KIND,
      documentId,
      localId,
      updatedAt: now,
    })
    .run();
  const attachment = {
    byteLength: 1,
    contentSha256: "digest",
    localId,
    mimeType: null,
    slotId: "slot",
    storageKey: `${localId}-bytes`,
  };
  if (view === "held" || view === "detached") {
    await db
      .insert(documentAttachmentBlobProjection)
      .values({
        ...attachment,
        blobId: "blob",
        detachedAt: view === "detached" ? now : null,
        updatedAt: now,
      })
      .run();
  }
  if (view === "pending") {
    await db
      .insert(documentPendingAttachments)
      .values({ ...attachment, createdAt: now, name: "file.txt" })
      .run();
  }
}
