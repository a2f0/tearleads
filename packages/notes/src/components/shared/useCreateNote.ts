import type { Database } from '@tearleads/db/sqlite';
import { notes, vfsRegistry } from '@tearleads/db/sqlite';
import { useCallback } from 'react';
import type {
  AuthFunctions,
  FeatureFlagFunctions,
  VfsApiFunctions,
  VfsKeyFunctions
} from '../../context/NotesContext';

interface UseCreateNoteParams {
  getDatabase: () => Database;
  onSelectNote: (noteId: string) => void;
  onError: (message: string) => void;
  vfsKeys: VfsKeyFunctions | undefined;
  auth: AuthFunctions | undefined;
  featureFlags: FeatureFlagFunctions | undefined;
  vfsApi: VfsApiFunctions | undefined;
}

export function useCreateNote({
  getDatabase,
  onSelectNote,
  onError,
  vfsKeys,
  auth,
  featureFlags,
  vfsApi
}: UseCreateNoteParams) {
  return useCallback(async () => {
    try {
      const db = getDatabase();
      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(notes).values({
        id,
        title: 'Untitled Note',
        content: '',
        createdAt: now,
        updatedAt: now,
        deleted: false
      });

      if (vfsKeys && auth) {
        const authData = auth.readStoredAuth();
        let encryptedSessionKey: string | null = null;

        if (auth.isLoggedIn()) {
          try {
            const sessionKey = vfsKeys.generateSessionKey();
            encryptedSessionKey = await vfsKeys.wrapSessionKey(sessionKey);
          } catch (err) {
            console.warn('Failed to wrap note session key:', err);
          }
        }

        await db.insert(vfsRegistry).values({
          id,
          objectType: 'note',
          ownerId: authData.user?.id ?? null,
          encryptedSessionKey,
          createdAt: now
        });

        if (
          auth.isLoggedIn() &&
          featureFlags?.getFeatureFlagValue('vfsServerRegistration') &&
          encryptedSessionKey &&
          vfsApi
        ) {
          try {
            await vfsApi.register({
              id,
              objectType: 'note',
              encryptedSessionKey
            });
          } catch (err) {
            console.warn('Failed to register note on server:', err);
          }
        }
      }

      onSelectNote(id);
    } catch (err) {
      console.error('Failed to create note:', err);
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onSelectNote, getDatabase, onError, vfsKeys, auth, featureFlags, vfsApi]);
}
