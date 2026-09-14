import { db } from "@tearleads/api-shared/postgres";
import { blobAuditObjects, blobs, users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { sha256Hex } from "../../src/utils/sha256";
import { registerUser } from "./registerUser";

export async function registerOrganization(): Promise<string> {
  const user = createTestUser();
  await registerUser(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user");
  return row.organizationId;
}

export async function insertDereferencedBlob(
  organizationId: string,
  dereferencedAt: Date,
): Promise<string> {
  const blobId = crypto.randomUUID();
  const storageKey = `organizations/${organizationId}/blob-stages/${blobId}`;
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

export async function deleteTestBlob(blobId: string): Promise<void> {
  await db.delete(blobs).where(eq(blobs.id, blobId));
  await db.delete(blobAuditObjects).where(eq(blobAuditObjects.blobId, blobId));
}
