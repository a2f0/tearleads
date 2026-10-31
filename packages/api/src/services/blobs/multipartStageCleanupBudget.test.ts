import { expect, test } from "bun:test";
import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { declaredFirstPart } from "../../../test/helpers/blobStageParts";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import {
  cleanupExpiredBlobStages,
  initiateMultipartBlobStage,
} from "./multipartStage";

async function stageExpiredUploads(count: number) {
  const owner = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  for (let index = 0; index < count; index += 1) {
    await initiateMultipartBlobStage(runtime, {
      ...owner,
      byteLength: 1,
      firstParts: declaredFirstPart(1),
      sha256: "encrypted-sha256",
    });
  }
  return { organizationId: owner.organizationId, runtime };
}

const AFTER_EXPIRY = () => new Date(Date.now() + 2 * 60 * 60 * 1000);

test("expired stage cleanup claims a batch in one statement", async () => {
  // Budget: candidate select, batch claim and row delete whatever the batch
  // size, plus one lease renewal per stage when the caller holds a lease.
  for (const count of [1, 3]) {
    for (const leased of [false, true]) {
      const { organizationId, runtime } = await stageExpiredUploads(count);
      let leaseChecks = 0;
      const counter = { statements: 0 };
      const hooks = {
        assertObjectDeletionLease: async () => {
          leaseChecks += 1;
          await runtime.db
            .select({ id: blobStages.id })
            .from(blobStages)
            .limit(1);
        },
      };
      const result = await withDatabaseStatementCounter(counter, () =>
        cleanupExpiredBlobStages(
          runtime,
          { now: AFTER_EXPIRY(), organizationId },
          leased ? hooks : undefined,
        ),
      );
      expect(result).toMatchObject({
        abortedMultipartUploads: count,
        deletedStages: count,
        failedStages: 0,
        scannedStages: count,
      });
      expect(leaseChecks).toBe(leased ? count : 0);
      expect(counter.statements).toBe(leased ? 3 + count : 3);
      expect(
        await runtime.db
          .select()
          .from(blobStages)
          .where(eq(blobStages.organizationId, organizationId)),
      ).toEqual([]);
    }
  }
});

test("a lease lost mid-batch stops object deletion for the rest", async () => {
  const { organizationId, runtime } = await stageExpiredUploads(3);
  const store = runtime.blobObjectStore;
  const aborted: string[] = [];
  runtime.blobObjectStore = {
    ...store,
    abortMultipartUpload: async (input) => {
      aborted.push(input.key);
      return store.abortMultipartUpload(input);
    },
  };
  const lost = new Error("lease lost");
  let checks = 0;
  const result = await cleanupExpiredBlobStages(
    runtime,
    { now: AFTER_EXPIRY(), organizationId },
    {
      assertObjectDeletionLease: async () => {
        checks += 1;
        // The renewals before the claim and before the second stage succeed.
        if (checks > 2) throw lost;
      },
    },
  );
  expect(aborted).toHaveLength(2);
  expect(result).toMatchObject({
    abortedMultipartUploads: 2,
    deletedStages: 2,
    failedStages: 1,
    failures: [lost],
  });
  // The fenced stage stays claimed for the next sweep.
  expect(
    await runtime.db
      .select({ id: blobStages.id })
      .from(blobStages)
      .where(eq(blobStages.organizationId, organizationId)),
  ).toHaveLength(1);
});

test("a lost lease fails every candidate and claims none", async () => {
  const { organizationId, runtime } = await stageExpiredUploads(2);
  const lost = new Error("lease lost");
  const result = await cleanupExpiredBlobStages(
    runtime,
    { now: AFTER_EXPIRY(), organizationId },
    {
      assertObjectDeletionLease: async () => {
        throw lost;
      },
    },
  );
  expect(result).toMatchObject({
    deletedStages: 0,
    failedStages: 2,
    failures: [lost, lost],
    scannedStages: 2,
  });
  const rows = await runtime.db
    .select({ expiresAt: blobStages.expiresAt })
    .from(blobStages)
    .where(eq(blobStages.organizationId, organizationId));
  // Unclaimed stages keep their own expiry instead of the claim's epoch mark.
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row.expiresAt.getTime()).toBeGreaterThan(0);
});
