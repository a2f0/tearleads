import { expect, spyOn, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  blobAuditObjects,
  blobs,
  containers,
  documentContentWriteHeaders,
  groups,
  organizationBilling,
  organizationRosterEntries,
  organizations,
  principalEpochKeys,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq, inArray } from "drizzle-orm";
import invariant from "invariant";
import { uploadBlobObject } from "../../../test/helpers/blobObjectStore";
import { registerUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { createMemoryBlobObjectStore } from "../../adapters/blobObjectStore";
import { sha256Hex } from "../../utils/sha256";
import {
  ORGANIZATION_PURGE_BATCH_SIZE,
  organizationPurgeBatches,
} from "../../workflows/billing/organizationPurgeBatches";
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

async function insertDereferencedBlob(
  organizationId: string,
  dereferencedAt: Date,
): Promise<string> {
  const blobId = crypto.randomUUID();
  const storageKey = `purge-scope:${blobId}`;
  const bytes = `blob:${blobId}`;
  await db.insert(blobs).values({
    id: blobId,
    storageKey,
    sha256: await sha256Hex(bytes),
    byteLength: bytes.length,
    dereferencedAt,
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
  return blobId;
}

async function deleteTestBlob(blobId: string): Promise<void> {
  await db.delete(blobs).where(eq(blobs.id, blobId));
  await db.delete(blobAuditObjects).where(eq(blobAuditObjects.blobId, blobId));
}

test("organization purge removes one organization's remote state and retains its control plane", async () => {
  const organizationId = await registerOrganization();
  const untouchedOrganizationId = await registerOrganization();
  // Keep this test's deliberately old blob outside wall-clock GC sweeps that
  // may run concurrently in another test file.
  const now = new Date("2099-08-27T12:00:00.000Z");
  const unrelatedBlobId = await insertDereferencedBlob(
    untouchedOrganizationId,
    new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000),
  );
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization groups");
  const principalIds = [
    organizationId,
    organization.adminGroupId,
    organization.memberGroupId,
  ];
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
  expect(
    await db.select().from(blobs).where(eq(blobs.id, unrelatedBlobId)),
  ).toHaveLength(1);
  expect(
    await db.select().from(groups).where(inArray(groups.id, principalIds)),
  ).toEqual([]);
  for (const table of [
    principalStatePayloads,
    principalEpochKeys,
    principalMemberEnvelopes,
    principalMembershipProjection,
    principalStates,
  ] as const) {
    expect(
      await db
        .select({ principalId: table.principalId })
        .from(table)
        .where(inArray(table.principalId, principalIds)),
    ).toEqual([]);
  }
  await deleteTestBlob(unrelatedBlobId);
});

test("organization purge with no claim does not run zero-grace global blob GC", async () => {
  const organizationId = await registerOrganization();
  // This maintenance call uses an explicit future clock while unrelated
  // wall-clock GC tests share the database.
  const now = new Date("2099-08-27T12:00:00.000Z");
  const blobId = await insertDereferencedBlob(
    organizationId,
    new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000),
  );

  expect(
    await runOrganizationPurgeMaintenance(createServiceTestRuntime(), {
      now,
      organizationIds: [organizationId],
    }),
  ).toEqual({ claimed: 0, failed: 0, purged: 0 });
  expect(
    await db.select().from(blobs).where(eq(blobs.id, blobId)),
  ).toHaveLength(1);
  await deleteTestBlob(blobId);
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

test("organization purge batches scopes larger than its SQL limit", async () => {
  const organizationId = await registerOrganization();
  const now = new Date("2099-08-29T12:00:00.000Z");
  const [root] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.organizationId, organizationId));
  invariant(root, "expected organization root");
  const childIds = Array.from(
    { length: ORGANIZATION_PURGE_BATCH_SIZE + 1 },
    () => crypto.randomUUID(),
  );
  for (const batch of organizationPurgeBatches(childIds)) {
    await db.insert(containers).values(
      batch.map((id) => ({
        depth: 1,
        id,
        organizationId,
        parentId: root.id,
      })),
    );
  }
  await db
    .update(organizationBilling)
    .set({ purgeAfter: new Date(now.getTime() - 1), status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));

  expect(
    await runOrganizationPurgeMaintenance(createServiceTestRuntime(), {
      now,
      organizationIds: [organizationId],
    }),
  ).toEqual({ claimed: 1, failed: 0, purged: 1 });
  expect(
    await db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.organizationId, organizationId)),
  ).toEqual([]);
});
