import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import type { BlobWriteAuthorization } from "@symcrypt/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeKeyingDomainHash,
  type WriteHeader,
} from "@symcrypt/crypto";
import {
  BlobContentKeyBundleError,
  listBlobContentWriteHeaders,
} from "../read/blobContentKeyStore";
import { storeBlobContentWriteHeader } from "./blobContentKeyStore";

async function hashOf(label: string): Promise<string> {
  return computeKeyingDomainHash("symcrypt.keying.access-event-body", {
    label,
  });
}

async function createBlobWriteHeader(input: {
  readonly blobId: string;
  readonly contentRecordId: string;
  readonly metadataSalt: string;
  readonly organizationId: string;
  readonly nonceDomainHash?: string;
}): Promise<WriteHeader> {
  const nonceDomainHash =
    input.nonceDomainHash ??
    (await computeContentRecordNonceDomainHash({
      version: 1,
      organizationId: input.organizationId,
      objectKind: "blob",
      objectId: input.blobId,
      contentKeyEpoch: 1,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: input.contentRecordId,
    }));

  return {
    version: 1,
    organizationId: input.organizationId,
    objectKind: "blob",
    objectId: input.blobId,
    accessManifestHash: await hashOf(`${input.metadataSalt}:manifest`),
    contentKeyEpoch: 1,
    targetHash: await hashOf(`${input.metadataSalt}:targets`),
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.contentRecordId,
    nonceDomainHash,
    metadataHash: await hashOf(`${input.metadataSalt}:metadata`),
    ciphertextHash: await hashOf(`${input.metadataSalt}:ciphertext`),
    writerUserId: crypto.randomUUID(),
    writerDeviceId: "device-1",
    writerKeyFingerprint: await hashOf(`${input.metadataSalt}:writer`),
    signedAt: new Date().toISOString(),
    signature: `${input.metadataSalt}:signature`,
  };
}

function blobWriteAuthorization(header: WriteHeader): BlobWriteAuthorization {
  return {
    activeBindingIds: [],
    blobAccessManifestHash: header.accessManifestHash,
    blobId: header.objectId,
    blobKeyTargetHash: header.targetHash,
    documentManifestHashes: [],
    linkedContainerKeyEpochIds: [],
    linkedContainerManifestHashes: [],
    organizationId: header.organizationId,
    targets: [],
  };
}

test("storeBlobContentWriteHeader stores canonical headers by record id", async () => {
  const recordId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const header = await createBlobWriteHeader({
    blobId,
    contentRecordId: "66666666-6666-4666-8666-666666666666",
    metadataSalt: "blob-write-header",
    organizationId,
  });
  const headerHash = await hashOf("blob-write-header");
  const authorization = blobWriteAuthorization(header);

  await storeBlobContentWriteHeader(
    { authorization, blobId, header, headerHash, recordId },
    db,
  );
  await storeBlobContentWriteHeader(
    { authorization, blobId, header, headerHash, recordId },
    db,
  );

  await expect(
    storeBlobContentWriteHeader(
      {
        authorization,
        blobId,
        header,
        headerHash: await hashOf("blob-write-header-conflict"),
        recordId,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header conflict", 409),
  );
  await expect(
    storeBlobContentWriteHeader(
      {
        authorization,
        blobId,
        header,
        headerHash,
        recordId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header conflict", 409),
  );
  await expect(
    storeBlobContentWriteHeader(
      {
        authorization,
        blobId,
        header: { ...header, objectKind: "document" },
        headerHash: await hashOf("blob-write-header-wrong-object"),
        recordId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header does not match blob", 409),
  );

  const secondRecordId = crypto.randomUUID();
  const secondHeader = await createBlobWriteHeader({
    blobId,
    contentRecordId: "99999999-9999-4999-8999-999999999999",
    metadataSalt: "blob-write-header-second",
    organizationId,
  });
  const secondHeaderHash = await hashOf("blob-write-header-second");
  const secondAuthorization = blobWriteAuthorization(secondHeader);
  await storeBlobContentWriteHeader(
    {
      authorization: secondAuthorization,
      blobId,
      header: secondHeader,
      headerHash: secondHeaderHash,
      recordId: secondRecordId,
    },
    db,
  );

  expect(
    await listBlobContentWriteHeaders([recordId, secondRecordId], db),
  ).toEqual(
    new Map([
      [recordId, { authorization, header, headerHash }],
      [
        secondRecordId,
        {
          authorization: secondAuthorization,
          header: secondHeader,
          headerHash: secondHeaderHash,
        },
      ],
    ]),
  );
});

test("storeBlobContentWriteHeader rejects reused content record domains", async () => {
  const blobId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const contentRecordId = "77777777-7777-4777-8777-777777777777";
  const header = await createBlobWriteHeader({
    blobId,
    contentRecordId,
    metadataSalt: "blob-record-domain",
    organizationId,
  });
  const authorization = blobWriteAuthorization(header);

  await storeBlobContentWriteHeader(
    {
      authorization,
      blobId,
      header,
      headerHash: await hashOf("blob-record-domain-header"),
      recordId: crypto.randomUUID(),
    },
    db,
  );

  await expect(
    storeBlobContentWriteHeader(
      {
        authorization,
        blobId,
        header: {
          ...header,
          metadataHash: await hashOf("blob-duplicate-record-metadata"),
          ciphertextHash: await hashOf("blob-duplicate-record-ciphertext"),
          signature: "blob-signature-2",
        },
        headerHash: await hashOf("blob-duplicate-record-header"),
        recordId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header conflict", 409),
  );

  await expect(
    storeBlobContentWriteHeader(
      {
        authorization,
        blobId,
        header: {
          ...header,
          contentRecordId: "88888888-8888-4888-8888-888888888888",
          metadataHash: await hashOf("blob-duplicate-domain-metadata"),
          ciphertextHash: await hashOf("blob-duplicate-domain-ciphertext"),
          signature: "blob-signature-3",
        },
        headerHash: await hashOf("blob-duplicate-domain-header"),
        recordId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header conflict", 409),
  );
});
