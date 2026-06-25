import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobStages,
  containers,
  groups,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { readBlobObjectText } from "../../../test/helpers/blobObjectStore";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { encodeMultipartBlobStageRecord } from "../../utils/blobStageRecords";
import { sha256Hex } from "../../utils/sha256";
import { runAccountPurgeMaintenance } from "./purge";

test("runAccountPurgeMaintenance purges disabled account data and staged blob objects", async () => {
  const runtime = createServiceTestRuntime();
  const { registration } = await registerServiceUser();
  const disabledAt = new Date("2026-05-01T00:00:00.000Z");
  const purgeAfter = new Date("2026-06-01T00:00:00.000Z");
  const storageKey = `account-purge-test/${crypto.randomUUID()}`;
  const encryptedBytes = "encrypted staged bytes";

  await runtime.blobObjectStore.putObject({
    bytes: encryptedBytes,
    key: storageKey,
    sha256: await sha256Hex(encryptedBytes),
  });
  await db.insert(blobStages).values({
    ownerUserId: registration.userId,
    encryptedBytes: encodeMultipartBlobStageRecord({
      state: "complete",
      storageKey,
      uploadId: "upload-id",
    }),
    sha256: await sha256Hex(encryptedBytes),
    byteLength: Buffer.byteLength(encryptedBytes, "utf8"),
    expiresAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  await db
    .update(users)
    .set({
      accountStatus: "disabled",
      disabledAt,
      purgeAfter,
    })
    .where(eq(users.id, registration.userId));

  const summary = await runAccountPurgeMaintenance(runtime, {
    now: new Date("2026-06-02T00:00:00.000Z"),
  });

  expect(summary).toEqual({
    abortedMultipartUploadCount: 0,
    deletedObjectCount: 1,
    failedObjectCleanupCount: 0,
    purgedAccountCount: 1,
  });
  expect(
    await readBlobObjectText(runtime.blobObjectStore, storageKey),
  ).toBeNull();

  const [user] = await db
    .select({
      accountStatus: users.accountStatus,
      disabledAt: users.disabledAt,
      purgeAfter: users.purgeAfter,
      purgeStartedAt: users.purgeStartedAt,
      purgedAt: users.purgedAt,
      remoteDataEpoch: users.remoteDataEpoch,
    })
    .from(users)
    .where(eq(users.id, registration.userId));
  expect(user).toEqual(
    expect.objectContaining({
      accountStatus: "purged",
      disabledAt,
      purgeAfter,
      remoteDataEpoch: 2,
    }),
  );
  expect(user?.purgeStartedAt?.toISOString()).toBe("2026-06-02T00:00:00.000Z");
  expect(user?.purgedAt?.toISOString()).toBe("2026-06-02T00:00:00.000Z");

  expect(
    await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, registration.organizationId)),
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(containers)
      .where(eq(containers.organizationId, registration.organizationId)),
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(groups)
      .where(eq(groups.organizationId, registration.organizationId)),
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(blobStages)
      .where(eq(blobStages.ownerUserId, registration.userId)),
  ).toEqual([]);
});
