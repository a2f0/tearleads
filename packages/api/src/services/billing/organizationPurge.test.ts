import { expect, spyOn, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  blobAuditObjects,
  blobs,
  containers,
  documentContentWriteHeaders,
  organizationBilling,
  organizationRosterEntries,
  organizations,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { uploadBlobObject } from "../../../test/helpers/blobObjectStore";
import { registerUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { createMemoryBlobObjectStore } from "../../adapters/blobObjectStore";
import { sha256Hex } from "../../utils/sha256";
import { runOrganizationPurgeMaintenance } from "./organizationPurge";

async function registerOrganization(): Promise<string> {
  const user = createTestUser();
  await registerUser(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user");
  return row.organizationId;
}

test("organization purge removes one organization's remote state and retains its control plane", async () => {
  const organizationId = await registerOrganization();
  const untouchedOrganizationId = await registerOrganization();
  const now = new Date("2026-08-27T12:00:00.000Z");
  await db
    .update(organizationBilling)
    .set({
      disabledAt: new Date(now.getTime() - 2_000),
      purgeAfter: new Date(now.getTime() - 1_000),
      status: "disabled",
    })
    .where(eq(organizationBilling.organizationId, organizationId));

  expect(
    await runOrganizationPurgeMaintenance(createServiceTestRuntime(), {
      now,
      organizationIds: [organizationId],
    }),
  ).toEqual({ claimed: 1, failed: 0, purged: 1 });

  const [billing] = await db
    .select({
      purgedAt: organizationBilling.purgedAt,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.status).toBe("purged");
  expect(billing?.purgedAt).toEqual(now);
  expect(
    await db
      .select()
      .from(containers)
      .where(eq(containers.organizationId, organizationId)),
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.organizationId, organizationId)),
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(organizationRosterEntries)
      .where(eq(organizationRosterEntries.organizationId, organizationId)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(containers)
      .where(eq(containers.organizationId, untouchedOrganizationId)),
  ).not.toEqual([]);
});

test("organization purge does not steal an active deletion lease", async () => {
  const organizationId = await registerOrganization();
  const now = new Date("2026-08-27T12:00:00.000Z");
  await db
    .update(organizationBilling)
    .set({ purgeStartedAt: now, status: "deleting" })
    .where(eq(organizationBilling.organizationId, organizationId));

  expect(
    await runOrganizationPurgeMaintenance(createServiceTestRuntime(), {
      now,
      organizationIds: [organizationId],
    }),
  ).toEqual({ claimed: 0, failed: 0, purged: 0 });
  const [billing] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.status).toBe("deleting");
});

test("organization stays deleting until object-store purge work succeeds", async () => {
  const organizationId = await registerOrganization();
  const firstNow = new Date("2026-08-27T12:00:00.000Z");
  await db
    .update(organizationBilling)
    .set({ purgeAfter: new Date(firstNow.getTime() - 1), status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const blobId = crypto.randomUUID();
  const storageKey = `purge-retry:${blobId}`;
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
  let failDeletion = true;
  const runtime = createServiceTestRuntime(db, {
    blobObjectStore: {
      ...objectStore,
      async deleteObject(key) {
        if (failDeletion) {
          failDeletion = false;
          throw new Error("temporary object-store failure");
        }
        return objectStore.deleteObject(key);
      },
    },
  });

  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  const firstSummary = await runOrganizationPurgeMaintenance(runtime, {
    now: firstNow,
    organizationIds: [organizationId],
  });
  errorSpy.mockRestore();
  expect(firstSummary).toEqual({ claimed: 1, failed: 1, purged: 0 });
  const [deleting] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(deleting?.status).toBe("deleting");

  expect(
    await runOrganizationPurgeMaintenance(runtime, {
      now: new Date(firstNow.getTime() + 6 * 60 * 1_000),
      organizationIds: [organizationId],
    }),
  ).toEqual({ claimed: 1, failed: 0, purged: 1 });
  const [purged] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(purged?.status).toBe("purged");
});
