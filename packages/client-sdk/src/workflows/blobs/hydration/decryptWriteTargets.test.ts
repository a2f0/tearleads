import { expect, test } from "bun:test";
import { signWriteHeader } from "@tearleads/crypto";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydration";
import { readWriteHeader } from "../../../data/documents/shared/readers";

async function decryptWith(
  fixture: Awaited<ReturnType<typeof createUploadedAttachmentFixture>>,
  binding: ReturnType<typeof createFixtureBinding>,
) {
  return createBlobAttachmentServiceFixture({
    api: {},
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).decryptDocumentAttachmentBlob({
    binding,
    encryptedBytes: fixture.stagedBlob.encryptedBytes,
    expectedDocumentId: fixture.writerProjection.documentId,
    expectedSlotId: fixture.attachment.slotId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    writerProjection: fixture.writerProjection,
  });
}

function withoutWriteTargets(binding: ReturnType<typeof createFixtureBinding>) {
  const { targets: _targets, ...writeAuthorization } =
    binding.writeAuthorization;
  return { ...binding, writeAuthorization };
}

test("an omitted write target set is refilled from the matching current set", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const binding = createFixtureBinding(fixture);
  expect(binding.writeAuthorization.blobKeyTargetHash).toBe(
    binding.blobKekTargets.blobKeyTargetHash,
  );
  const bytes = await decryptWith(fixture, withoutWriteTargets(binding));
  expect(Array.from(bytes)).toEqual(Array.from(fixture.bytes));
});

test("an omitted write target set behind another hash fails closed", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const binding = withoutWriteTargets(createFixtureBinding(fixture));
  await expect(
    decryptWith(fixture, {
      ...binding,
      writeAuthorization: {
        ...binding.writeAuthorization,
        blobKeyTargetHash: "another-target-hash",
      },
    }),
  ).rejects.toThrow("Attachment blob write authorization lacks its targets");
});

test("a refilled target set the signed header does not commit to fails closed", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const binding = withoutWriteTargets(createFixtureBinding(fixture));
  // The writer signs a header committing to another target hash; the listing
  // still claims the write's hash matches the current set.
  const { signature: _signature, ...unsigned } = readWriteHeader(
    binding.writeHeader,
    "Uploaded blob write header",
  );
  const writeHeader = await signWriteHeader(
    { ...unsigned, targetHash: "f".repeat(64) },
    fixture.author.signerPrivateKey,
  );
  await expect(
    decryptWith(fixture, { ...binding, writeHeader: { ...writeHeader } }),
  ).rejects.toThrow("write header target hash does not match expected hash");
});
