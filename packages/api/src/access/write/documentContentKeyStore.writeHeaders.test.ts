import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  type WriteHeader,
} from "@tearleads/crypto";
import { hashOf } from "../../../test/helpers/documentContentKeyStoreFixtures";
import { listDocumentContentWriteHeaders } from "../read/documentContentKeyStore";
import {
  DocumentContentKeyBundleError,
  storeDocumentContentWriteHeader,
} from "./documentContentKeyStore";

test("storeDocumentContentWriteHeader stores canonical headers by update id", async () => {
  const updateId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const contentRecordId = "33333333-3333-4333-8333-333333333333";
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    contentKeyEpoch: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  });
  const header: WriteHeader = {
    dependencyManifestHashes: [],
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    accessManifestHash: await hashOf("write-header-manifest"),
    contentKeyEpoch: 1,
    targetHash: await hashOf("write-header-targets"),
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
    nonceDomainHash,
    metadataHash: await hashOf("write-header-metadata"),
    ciphertextHash: await hashOf("write-header-ciphertext"),
    writerUserId: crypto.randomUUID(),
    writerDeviceId: "device-1",
    writerKeyFingerprint: await hashOf("write-header-writer"),
    signedAt: new Date().toISOString(),
    signature: "signature",
  };
  const headerHash = await hashOf("write-header");

  await storeDocumentContentWriteHeader(
    {
      authorizationTargets: [],
      documentId,
      header,
      headerHash,
      updateId,
    },
    db,
  );
  await storeDocumentContentWriteHeader(
    {
      authorizationTargets: [],
      documentId,
      header,
      headerHash,
      updateId,
    },
    db,
  );

  await expect(
    storeDocumentContentWriteHeader(
      {
        authorizationTargets: [],
        documentId,
        header,
        headerHash: await hashOf("write-header-conflict"),
        updateId,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );
  await expect(
    storeDocumentContentWriteHeader(
      {
        authorizationTargets: [],
        documentId,
        header,
        headerHash,
        updateId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );
  await expect(
    storeDocumentContentWriteHeader(
      {
        authorizationTargets: [],
        documentId,
        header: { ...header, objectKind: "blob" },
        headerHash: await hashOf("write-header-wrong-object"),
        updateId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document write header does not match document",
      409,
    ),
  );

  const secondUpdateId = crypto.randomUUID();
  const secondContentRecordId = "66666666-6666-4666-8666-666666666666";
  const secondHeader: WriteHeader = {
    ...header,
    contentRecordId: secondContentRecordId,
    nonceDomainHash: await computeContentRecordNonceDomainHash({
      version: 1,
      organizationId,
      objectKind: "document",
      objectId: documentId,
      contentKeyEpoch: 1,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: secondContentRecordId,
    }),
    metadataHash: await hashOf("write-header-second-metadata"),
    ciphertextHash: await hashOf("write-header-second-ciphertext"),
    signature: "signature-2",
  };
  const secondHeaderHash = await hashOf("write-header-second");
  await storeDocumentContentWriteHeader(
    {
      authorizationTargets: [],
      documentId,
      header: secondHeader,
      headerHash: secondHeaderHash,
      updateId: secondUpdateId,
    },
    db,
  );

  expect(
    await listDocumentContentWriteHeaders([updateId, secondUpdateId], db),
  ).toEqual(
    new Map([
      [updateId, { authorizationTargets: [], header, headerHash }],
      [
        secondUpdateId,
        {
          authorizationTargets: [],
          header: secondHeader,
          headerHash: secondHeaderHash,
        },
      ],
    ]),
  );
});

test("storeDocumentContentWriteHeader rejects reused content record domains", async () => {
  const documentId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const contentRecordId = "44444444-4444-4444-8444-444444444444";
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    contentKeyEpoch: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  });
  const header: WriteHeader = {
    dependencyManifestHashes: [],
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    accessManifestHash: await hashOf("record-domain-manifest"),
    contentKeyEpoch: 1,
    targetHash: await hashOf("record-domain-targets"),
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
    nonceDomainHash,
    metadataHash: await hashOf("record-domain-metadata"),
    ciphertextHash: await hashOf("record-domain-ciphertext"),
    writerUserId: crypto.randomUUID(),
    writerDeviceId: "device-1",
    writerKeyFingerprint: await hashOf("record-domain-writer"),
    signedAt: new Date().toISOString(),
    signature: "signature",
  };

  await storeDocumentContentWriteHeader(
    {
      authorizationTargets: [],
      documentId,
      header,
      headerHash: await hashOf("record-domain-header"),
      updateId: crypto.randomUUID(),
    },
    db,
  );

  await expect(
    storeDocumentContentWriteHeader(
      {
        authorizationTargets: [],
        documentId,
        header: {
          ...header,
          metadataHash: await hashOf("duplicate-record-metadata"),
          ciphertextHash: await hashOf("duplicate-record-ciphertext"),
          signature: "signature-2",
        },
        headerHash: await hashOf("duplicate-record-header"),
        updateId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );

  await expect(
    storeDocumentContentWriteHeader(
      {
        authorizationTargets: [],
        documentId,
        header: {
          ...header,
          contentRecordId: "55555555-5555-4555-8555-555555555555",
          metadataHash: await hashOf("duplicate-domain-metadata"),
          ciphertextHash: await hashOf("duplicate-domain-ciphertext"),
          signature: "signature-3",
        },
        headerHash: await hashOf("duplicate-domain-header"),
        updateId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );
});
