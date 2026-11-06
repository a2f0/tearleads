import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobContentWriteHeaders,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
} from "@tearleads/api-shared/schema";
import type { KeyingCanonicalJson } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  contentRecordEncryptionSuite,
  createLinkedContainerIds,
  createWriteHeader,
  fixtureHash,
} from "../test/helpers/accessSchemaRows";

test("document content key schema stores epochs, targets, and write headers through Drizzle", async () => {
  const {
    containerId,
    containerKeyEpochId,
    containerManifestHash,
    documentId,
    organizationId,
    writerUserId,
  } = createLinkedContainerIds();
  const documentManifestHash = fixtureHash("document-manifest");
  const documentTargetHash = fixtureHash("document-target");
  const wrapMetadata = {
    suite: "schema-test-wrap",
    iv: fixtureHash("wrap-iv"),
  } satisfies KeyingCanonicalJson;
  const documentContentEpochId = crypto.randomUUID();
  const documentContentRecordId = fixtureHash("document-content-record");
  const documentNonceDomainHash = fixtureHash("document-nonce-domain");
  const documentHeader = createWriteHeader({
    accessManifestHash: documentManifestHash,
    contentKeyEpoch: 1,
    contentRecordId: documentContentRecordId,
    nonceDomainHash: documentNonceDomainHash,
    objectId: documentId,
    objectKind: "document",
    organizationId,
    targetHash: documentTargetHash,
    writerUserId,
  });

  await db.insert(documentContentKeyEpochs).values({
    id: documentContentEpochId,
    documentId,
    contentKeyEpoch: 1,
    linkSetManifestHash: documentManifestHash,
    targetHash: documentTargetHash,
  });
  await db.insert(documentContentKeyTargets).values({
    documentContentKeyEpochId: documentContentEpochId,
    containerId,
    containerManifestHash,
    containerKeyEpochId,
    containerKeyEpoch: 1,
    wrappedKey: fixtureHash("document-wrapped-key"),
    wrappingMetadata: wrapMetadata,
  });
  await db.insert(documentContentWriteHeaders).values({
    authorizationTargets: [
      {
        containerId,
        containerManifestHash,
        containerKeyEpochId,
        containerKeyEpoch: 1,
      },
    ],
    updateId: crypto.randomUUID(),
    documentId,
    organizationId,
    contentKeyEpoch: 1,
    accessManifestHash: documentManifestHash,
    targetHash: documentTargetHash,
    encryptionSuite: contentRecordEncryptionSuite,
    contentRecordId: documentContentRecordId,
    nonceDomainHash: documentNonceDomainHash,
    headerHash: fixtureHash("document-header"),
    header: documentHeader,
  });

  expect(
    await db
      .select({
        documentId: documentContentKeyEpochs.documentId,
        targetHash: documentContentKeyEpochs.targetHash,
      })
      .from(documentContentKeyEpochs)
      .where(eq(documentContentKeyEpochs.id, documentContentEpochId)),
  ).toEqual([{ documentId, targetHash: documentTargetHash }]);
  expect(
    await db
      .select({
        containerKeyEpochId: documentContentKeyTargets.containerKeyEpochId,
        wrappingMetadata: documentContentKeyTargets.wrappingMetadata,
      })
      .from(documentContentKeyTargets)
      .where(
        eq(
          documentContentKeyTargets.documentContentKeyEpochId,
          documentContentEpochId,
        ),
      ),
  ).toEqual([{ containerKeyEpochId, wrappingMetadata: wrapMetadata }]);
  expect(
    await db
      .select({
        contentRecordId: documentContentWriteHeaders.contentRecordId,
        header: documentContentWriteHeaders.header,
      })
      .from(documentContentWriteHeaders)
      .where(
        eq(
          documentContentWriteHeaders.contentRecordId,
          documentContentRecordId,
        ),
      ),
  ).toEqual([
    { contentRecordId: documentContentRecordId, header: documentHeader },
  ]);
});

test("blob content key schema stores epochs, targets, and write headers through Drizzle", async () => {
  const {
    containerId,
    containerKeyEpochId,
    containerManifestHash,
    documentId,
    organizationId,
    writerUserId,
  } = createLinkedContainerIds();
  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const documentManifestHash = fixtureHash("document-manifest");
  const blobManifestHash = fixtureHash("blob-manifest");
  const blobTargetHash = fixtureHash("blob-target");
  const wrapMetadata = {
    suite: "schema-test-wrap",
    iv: fixtureHash("wrap-iv"),
  } satisfies KeyingCanonicalJson;
  const blobContentEpochId = crypto.randomUUID();
  const blobContentRecordId = fixtureHash("blob-content-record");
  const blobNonceDomainHash = fixtureHash("blob-nonce-domain");
  const blobHeader = createWriteHeader({
    accessManifestHash: blobManifestHash,
    contentKeyEpoch: 1,
    contentRecordId: blobContentRecordId,
    nonceDomainHash: blobNonceDomainHash,
    objectId: blobId,
    objectKind: "blob",
    organizationId,
    targetHash: blobTargetHash,
    writerUserId,
  });

  await db.insert(blobContentKeyEpochs).values({
    id: blobContentEpochId,
    blobId,
    contentKeyEpoch: 1,
    targetHash: blobTargetHash,
  });
  await db.insert(blobContentKeyTargets).values({
    blobContentKeyEpochId: blobContentEpochId,
    bundleTargetHash: blobTargetHash,
    bindingId,
    documentId,
    containerId,
    containerManifestHash,
    containerKeyEpochId,
    containerKeyEpoch: 1,
    wrappedKey: fixtureHash("blob-wrapped-key"),
    wrappingMetadata: wrapMetadata,
  });
  await db.insert(blobContentWriteHeaders).values({
    authorization: {
      activeBindingIds: [bindingId],
      blobId,
      blobAccessManifestHash: blobManifestHash,
      blobKeyTargetHash: blobTargetHash,
      documentManifestHashes: [documentManifestHash],
      linkedContainerKeyEpochIds: [containerKeyEpochId],
      linkedContainerManifestHashes: [containerManifestHash],
      organizationId,
      targets: [
        {
          bindingId,
          documentId,
          containerId,
          containerManifestHash,
          containerKeyEpochId,
          containerKeyEpoch: 1,
        },
      ],
    },
    recordId: crypto.randomUUID(),
    blobId,
    organizationId,
    contentKeyEpoch: 1,
    accessManifestHash: blobManifestHash,
    targetHash: blobTargetHash,
    encryptionSuite: contentRecordEncryptionSuite,
    contentRecordId: blobContentRecordId,
    nonceDomainHash: blobNonceDomainHash,
    headerHash: fixtureHash("blob-header"),
    header: blobHeader,
  });

  expect(
    await db
      .select({
        blobId: blobContentKeyEpochs.blobId,
        targetHash: blobContentKeyEpochs.targetHash,
      })
      .from(blobContentKeyEpochs)
      .where(eq(blobContentKeyEpochs.id, blobContentEpochId)),
  ).toEqual([{ blobId, targetHash: blobTargetHash }]);
  expect(
    await db
      .select({
        bindingId: blobContentKeyTargets.bindingId,
        wrappingMetadata: blobContentKeyTargets.wrappingMetadata,
      })
      .from(blobContentKeyTargets)
      .where(
        eq(blobContentKeyTargets.blobContentKeyEpochId, blobContentEpochId),
      ),
  ).toEqual([{ bindingId, wrappingMetadata: wrapMetadata }]);
  expect(
    await db
      .select({
        contentRecordId: blobContentWriteHeaders.contentRecordId,
        header: blobContentWriteHeaders.header,
      })
      .from(blobContentWriteHeaders)
      .where(eq(blobContentWriteHeaders.contentRecordId, blobContentRecordId)),
  ).toEqual([{ contentRecordId: blobContentRecordId, header: blobHeader }]);
});
