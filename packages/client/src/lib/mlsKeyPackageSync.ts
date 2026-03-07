/**
 * MLS key package outbox: persist pending key packages in userSettings
 * and flush them to the server via the UploadKeyPackages RPC.
 *
 * On registration, key packages are written to the outbox. A fire-and-forget
 * flush uploads them. If the flush fails, the outbox entry persists and is
 * retried on next app initialization.
 */

import { createMlsV2Routes } from '@tearleads/api-client/mlsRoutes';
import type { MlsCipherSuite } from '@tearleads/shared';
import { MLS_CIPHERSUITES } from '@tearleads/shared';
import { eq } from 'drizzle-orm';
import { getDatabase, isDatabaseInitialized } from '@/db';
import { userSettings } from '@/db/schema';

const OUTBOX_KEY_PREFIX = 'mls_pending_key_packages';

interface PendingKeyPackage {
  keyPackageData: string;
  keyPackageRef: string;
  cipherSuite: MlsCipherSuite;
}

function outboxKey(userId: string): string {
  return `${OUTBOX_KEY_PREFIX}:${userId}`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function writeMlsKeyPackagesToOutbox(
  userId: string,
  keyPackages: Array<{ keyPackageData: Uint8Array; keyPackageRef: string }>
): Promise<void> {
  if (!isDatabaseInitialized() || keyPackages.length === 0) {
    return;
  }

  const pending: PendingKeyPackage[] = keyPackages.map((kp) => ({
    keyPackageData: uint8ArrayToBase64(kp.keyPackageData),
    keyPackageRef: kp.keyPackageRef,
    cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
  }));

  const key = outboxKey(userId);
  const now = new Date();
  const db = getDatabase();
  await db
    .insert(userSettings)
    .values({ key, value: JSON.stringify(pending), updatedAt: now })
    .onConflictDoUpdate({
      target: userSettings.key,
      set: { value: JSON.stringify(pending), updatedAt: now }
    });
}

export async function flushMlsKeyPackageOutbox(userId: string): Promise<void> {
  if (!isDatabaseInitialized()) {
    return;
  }

  const key = outboxKey(userId);
  const db = getDatabase();

  const rows = await db
    .select({ value: userSettings.value })
    .from(userSettings)
    .where(eq(userSettings.key, key))
    .limit(1);

  const row = rows[0];
  if (!row?.value) {
    return;
  }

  let pending: PendingKeyPackage[];
  try {
    pending = JSON.parse(row.value) as PendingKeyPackage[];
  } catch {
    await db.delete(userSettings).where(eq(userSettings.key, key));
    return;
  }

  if (!Array.isArray(pending) || pending.length === 0) {
    await db.delete(userSettings).where(eq(userSettings.key, key));
    return;
  }

  const mlsRoutes = createMlsV2Routes();
  await mlsRoutes.uploadKeyPackages({
    keyPackages: pending.map((kp) => ({
      keyPackageData: base64ToUint8Array(kp.keyPackageData),
      keyPackageRef: kp.keyPackageRef,
      cipherSuite: kp.cipherSuite
    }))
  });

  await db.delete(userSettings).where(eq(userSettings.key, key));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
