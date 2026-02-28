/**
 * One-time runtime backfill: sets organization_id on contacts and vfs_registry
 * rows that were created before org attribution was added (migration v027).
 *
 * Completion is tracked per-user in IndexedDB so the backfill runs at most once.
 */

import type { Database } from '@tearleads/db/sqlite';
import { isNull } from 'drizzle-orm';
import { contacts, vfsRegistry } from '@/db/schema';
import { getFromStore, setInStore } from './registryStore';

function backfillKey(userId: string): string {
  return `org_backfill_${userId}`;
}

export async function runOrgBackfillIfNeeded(
  db: Database,
  userId: string,
  personalOrgId: string
): Promise<void> {
  const alreadyDone = await getFromStore<boolean>(backfillKey(userId));
  if (alreadyDone) return;

  await db
    .update(contacts)
    .set({ organizationId: personalOrgId })
    .where(isNull(contacts.organizationId));

  await db
    .update(vfsRegistry)
    .set({ organizationId: personalOrgId })
    .where(isNull(vfsRegistry.organizationId));

  await setInStore(backfillKey(userId), true);
}
