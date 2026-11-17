import { expect, test } from "bun:test";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydration";

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

test("a refilled target set the signed hash does not cover fails closed", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const binding = withoutWriteTargets(createFixtureBinding(fixture));
  // The current set claims the write's hash but lists other targets.
  await expect(
    decryptWith(fixture, {
      ...binding,
      blobKekTargets: { ...binding.blobKekTargets, targets: [] },
    }),
  ).rejects.toThrow();
});
