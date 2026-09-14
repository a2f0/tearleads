import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobAuditObjects,
  blobs,
  containers,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { uploadBlobObject } from "../../../test/helpers/blobObjectStore";
import { registerOrganization } from "../../../test/helpers/organizationPurge";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { createMemoryBlobObjectStore } from "../../adapters/blobObjectStore";
import * as background from "../../diagnostics/reportBackgroundFailure";
import { sha256Hex } from "../../utils/sha256";
import { runOrganizationPurgeMaintenance } from "./organizationPurge";

test("a stalled broker cannot block an organization purge or its blob cleanup", async () => {
  const organizationId = await registerOrganization();
  const now = new Date("2099-08-30T12:00:00.000Z");
  await db
    .update(organizationBilling)
    .set({ purgeAfter: new Date(now.getTime() - 1), status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const blobId = crypto.randomUUID();
  const storageKey = `organizations/${organizationId}/blob-stages/${blobId}`;
  const bytes = "remote organization bytes";
  await db.insert(blobs).values({
    id: blobId,
    storageKey,
    sha256: await sha256Hex(bytes),
    byteLength: bytes.length,
  });
  await db.insert(blobAuditObjects).values({
    blobId,
    byteLength: bytes.length,
    historicalBytesRetained: false,
    liveStorageKey: storageKey,
    organizationId,
    retentionMode: "live_only",
    sha256: await sha256Hex(bytes),
  });
  const objectStore = createMemoryBlobObjectStore();
  await uploadBlobObject(objectStore, storageKey, bytes);
  const deletedKeys: string[] = [];
  let publishes = 0;
  const runtime = {
    ...createServiceTestRuntime(db, {
      blobObjectStore: {
        ...objectStore,
        async deleteObject(key) {
          deletedKeys.push(key);
          return objectStore.deleteObject(key);
        },
      },
    }),
    eventPublisher: {
      // Redis publishes carry no command timeout; model a broker that never
      // answers.
      publish: () => {
        publishes += 1;
        return new Promise<void>(() => undefined);
      },
    },
  };
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  const report = spyOn(
    background,
    "reportBackgroundFailure",
  ).mockImplementation(() => undefined);
  try {
    expect(
      await runOrganizationPurgeMaintenance(
        runtime,
        { now, organizationIds: [organizationId] },
        { notificationTimeoutMs: 20 },
      ),
    ).toEqual({ claimed: 1, failed: 0, purged: 1 });
    expect(publishes).toBeGreaterThan(0);
    // One report for the abandoned stage, not one per unanswered publish.
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  } finally {
    report.mockRestore();
    errorSpy.mockRestore();
  }
  expect(deletedKeys).toContain(storageKey);
  expect(
    await db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.organizationId, organizationId)),
  ).toEqual([]);
});
