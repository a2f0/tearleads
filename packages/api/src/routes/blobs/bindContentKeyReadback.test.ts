import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobContentKeyEpochs,
  blobContentKeyTargets,
} from "@tearleads/api-shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import {
  blobRewrapFixture,
  expectBlobRewrapUnchanged,
  snapshotBlobRewrap,
} from "../../../test/helpers/blobRewrapReadbackKit";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { probeTransactions } from "../../../test/helpers/transactionProgress";
import { bindBlobAttachment } from "../../services/blobs/blobMutations";

test("signed blob create compares the actual stored target material", async () => {
  const fixture = {
    ...(await blobRewrapFixture()),
    blobId: crypto.randomUUID(),
  };
  const { request } = await buildBind({
    ...fixture,
    slotId: "create-readback",
    stagedBlob: await stageBlob(fixture.owner, fixture.blobId),
  });
  const before = await snapshotBlobRewrap(fixture);
  const replacement = contentKeyEnvelopeFixture(
    "Blob",
    "stored-create-material",
  ).wrappedKey;
  expect(request.contentKeyBundle.targets[0]?.wrappedKey).not.toBe(replacement);
  let reached = 0;
  const observed = probeTransactions(db, {
    after: async (query, tx) => {
      if (!query.startsWith('insert into "blob_content_key_targets"')) return;
      reached += 1;
      // Change real persisted bytes after insertion, without substituting a query result.
      await tx
        .update(blobContentKeyTargets)
        .set({ wrappedKey: replacement })
        .where(
          inArray(
            blobContentKeyTargets.blobContentKeyEpochId,
            tx
              .select({ id: blobContentKeyEpochs.id })
              .from(blobContentKeyEpochs)
              .where(eq(blobContentKeyEpochs.blobId, fixture.blobId)),
          ),
        );
    },
  });
  const runtime = createServiceTestRuntime(observed.database, {
    blobObjectStore: blobAttachmentTestRuntime.blobObjectStore,
  });
  const error = await bindBlobAttachment(runtime, {
    blobId: fixture.blobId,
    fingerprint: fixture.owner.fingerprint,
    request,
    sessionId: "blob-create-readback",
    userId: fixture.owner.userId,
  }).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toMatchObject({
    message: "Blob content-key bundle conflict",
    status: 409,
  });
  expect(reached).toBe(1);
  await expectBlobRewrapUnchanged(fixture, before);
});
