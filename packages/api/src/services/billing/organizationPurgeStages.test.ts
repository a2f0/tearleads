import { expect, test } from "bun:test";
import { blobStages, organizationBilling } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { initiateMultipartBlobStage } from "../blobs/multipartStage";
import { runOrganizationPurgeMaintenance } from "./organizationPurge";

test("organization purge retries failed stage cleanup before finalizing and preserves foreign uploads", async () => {
  const first = await createBlobStageOwner();
  const second = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  const metadata = { byteLength: 1, sha256: "encrypted-sha256" };
  const staged = await initiateMultipartBlobStage(runtime, {
    ...metadata,
    ...first,
  });
  const retained = await initiateMultipartBlobStage(runtime, {
    ...metadata,
    ...second,
  });
  const now = new Date();
  await runtime.db
    .update(organizationBilling)
    .set({
      status: "disabled",
      purgeAfter: new Date(now.getTime() - 1),
    })
    .where(eq(organizationBilling.organizationId, first.organizationId));
  const store = runtime.blobObjectStore;
  const aborted: string[] = [];
  let failAbort = true;
  runtime.blobObjectStore = {
    ...store,
    abortMultipartUpload: async (input) => {
      aborted.push(input.key);
      if (failAbort) throw new Error("object store unavailable");
      return store.abortMultipartUpload(input);
    },
  };
  const failed = await runOrganizationPurgeMaintenance(runtime, {
    organizationIds: [first.organizationId],
    now,
  });
  expect(failed).toEqual({ claimed: 1, failed: 1, purged: 0 });
  const [billing] = await runtime.db
    .select()
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, first.organizationId));
  expect(billing?.status).toBe("deleting");
  failAbort = false;
  const retried = await runOrganizationPurgeMaintenance(runtime, {
    organizationIds: [first.organizationId],
    now: new Date(now.getTime() + 6 * 60 * 1000),
  });
  expect(retried).toEqual({ claimed: 1, failed: 0, purged: 1 });
  const key = `organizations/${first.organizationId}/blob-stages/${staged.stageId}`;
  expect(aborted).toEqual([key, key]);
  const foreignKey = `organizations/${second.organizationId}/blob-stages/${retained.stageId}`;
  expect(
    await store.listParts({ key: foreignKey, uploadId: retained.uploadId }),
  ).toEqual([]);
  expect(
    await runtime.db
      .select()
      .from(blobStages)
      .where(eq(blobStages.id, retained.stageId)),
  ).toHaveLength(1);
});

test("an upload created during organization purge is aborted instead of persisting after purge", async () => {
  const owner = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  const now = new Date();
  await runtime.db
    .update(organizationBilling)
    .set({
      status: "disabled",
      purgeAfter: new Date(now.getTime() - 1),
    })
    .where(eq(organizationBilling.organizationId, owner.organizationId));
  const store = runtime.blobObjectStore;
  const aborted: string[] = [];
  runtime.blobObjectStore = {
    ...store,
    createMultipartUpload: async (input) => {
      const upload = await store.createMultipartUpload(input);
      expect(
        await runOrganizationPurgeMaintenance(runtime, {
          organizationIds: [owner.organizationId],
          now,
        }),
      ).toEqual({ claimed: 1, failed: 0, purged: 1 });
      return upload;
    },
    abortMultipartUpload: async (input) => {
      aborted.push(input.key);
      return store.abortMultipartUpload(input);
    },
  };
  await expect(
    initiateMultipartBlobStage(runtime, {
      ...owner,
      byteLength: 1,
      sha256: "encrypted-sha256",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(aborted).toHaveLength(1);
  expect(
    await runtime.db
      .select()
      .from(blobStages)
      .where(eq(blobStages.organizationId, owner.organizationId)),
  ).toEqual([]);
});
