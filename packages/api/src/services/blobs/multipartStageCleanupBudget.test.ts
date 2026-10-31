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

test("expired stage cleanup claims a batch in one statement", async () => {
  // Budget: candidate select, lease renewal, batch claim and row delete,
  // whatever the batch size.
  for (const count of [1, 3]) {
    const { organizationId, runtime } = await stageExpiredUploads(count);
    let leaseChecks = 0;
    const counter = { statements: 0 };
    const result = await withDatabaseStatementCounter(counter, () =>
      cleanupExpiredBlobStages(
        runtime,
        { now: new Date(Date.now() + 2 * 60 * 60 * 1000), organizationId },
        {
          assertObjectDeletionLease: async () => {
            leaseChecks += 1;
            await runtime.db
              .select({ id: blobStages.id })
              .from(blobStages)
              .limit(1);
          },
        },
      ),
    );
    expect(result).toMatchObject({
      abortedMultipartUploads: count,
      deletedStages: count,
      failedStages: 0,
      scannedStages: count,
    });
    expect(leaseChecks).toBe(1);
    expect(counter.statements).toBe(4);
    expect(
      await runtime.db
        .select()
        .from(blobStages)
        .where(eq(blobStages.organizationId, organizationId)),
    ).toEqual([]);
  }
});

test("a lost lease fails every candidate and claims none", async () => {
  const { organizationId, runtime } = await stageExpiredUploads(2);
  const lost = new Error("lease lost");
  const result = await cleanupExpiredBlobStages(
    runtime,
    { now: new Date(Date.now() + 2 * 60 * 60 * 1000), organizationId },
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
