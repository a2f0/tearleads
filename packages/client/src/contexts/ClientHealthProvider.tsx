import {
  createHealthTracker,
  HealthRuntimeProvider
} from '@tearleads/app-health/clientEntry';
import type { AvailableContact } from '@tearleads/app-health/clientEntry';
import { contacts, vfsRegistry } from '@tearleads/db/sqlite';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { eq } from 'drizzle-orm';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useDatabaseContext } from '@/db/hooks';
import { useHostRuntimeDatabaseState } from '@/db/hooks/useHostRuntimeDatabaseState';
import { registerVfsItemWithCurrentKeys } from '@/hooks/vfs/useVfsKeys';
import { isLoggedIn, readStoredAuth } from '@/lib/authStorage';
import { getFeatureFlagValue } from '@/lib/featureFlags';
import { queueLinkReassignAndFlush } from '@/lib/vfsItemSyncWriter';

interface ClientHealthProviderProps {
  children: ReactNode;
}

export function ClientHealthProvider({ children }: ClientHealthProviderProps) {
  const { db } = useDatabaseContext();
  const databaseState = useHostRuntimeDatabaseState();
  const [availableContacts, setAvailableContacts] = useState<
    AvailableContact[]
  >([]);

  useEffect(() => {
    if (!db || !databaseState.isUnlocked) {
      setAvailableContacts([]);
      return;
    }

    let cancelled = false;
    const loadContacts = async () => {
      const rows = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName
        })
        .from(contacts)
        .where(eq(contacts.deleted, false));

      if (cancelled) {
        return;
      }

      setAvailableContacts(
        rows.map((row) => ({
          id: row.id,
          name: [row.firstName, row.lastName].filter(Boolean).join(' ')
        }))
      );
    };

    void loadContacts();
    return () => {
      cancelled = true;
    };
  }, [db, databaseState.isUnlocked]);

  const createTracker = useCallback(() => {
    if (!db) {
      throw new Error('Health tracker requires an unlocked database');
    }

    return createHealthTracker(db);
  }, [db]);

  const registerReadingInVfs = useCallback(
    async (readingId: string, createdAt: string) => {
      if (!db) {
        return;
      }

      let encryptedSessionKey: string | null = null;
      if (isLoggedIn()) {
        try {
          const result = await registerVfsItemWithCurrentKeys({
            id: readingId,
            objectType: 'healthReading',
            registerOnServer: getFeatureFlagValue('vfsServerRegistration')
          });
          encryptedSessionKey = result.encryptedSessionKey;
        } catch (err) {
          console.warn('Failed to wrap health reading session key:', err);
        }
      }

      const auth = readStoredAuth();
      await db.insert(vfsRegistry).values({
        id: readingId,
        objectType: 'healthReading',
        ownerId: auth.user?.id ?? null,
        encryptedSessionKey,
        createdAt: new Date(createdAt)
      });
    },
    [db]
  );

  const linkReadingToContact = useCallback(
    async (readingId: string, contactId: string) => {
      await queueLinkReassignAndFlush({
        childId: readingId,
        parentId: contactId
      });
    },
    []
  );

  return (
    <HealthRuntimeProvider
      databaseState={databaseState}
      createTracker={createTracker}
      InlineUnlock={InlineUnlock}
      registerReadingInVfs={registerReadingInVfs}
      linkReadingToContact={linkReadingToContact}
      availableContacts={availableContacts}
    >
      {children}
    </HealthRuntimeProvider>
  );
}
