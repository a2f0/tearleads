import { expect, setSystemTime, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { blobAuditObjects, blobs } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { seedPendingBlobDeletion } from "../../../test/helpers/pendingBlobDeletion";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { listRootPendingBlobDeletions } from "./pendingDeletions";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "pending deletion eligibility follows database time despite API host clock skew",
  async () => {
    const organizationId = crypto.randomUUID();
    const pending = await seedPendingBlobDeletion(db, organizationId);
    try {
      setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
      const page = await listRootPendingBlobDeletions(
        createServiceTestRuntime(db),
        { organizationId },
      );
      expect(page.blobs).toHaveLength(1);
      expect(page.blobs[0]?.status).toBe("grace-period");
    } finally {
      setSystemTime();
      await db.delete(blobs).where(eq(blobs.id, pending.blobId));
      await db
        .delete(blobAuditObjects)
        .where(eq(blobAuditObjects.blobId, pending.blobId));
    }
  },
);
