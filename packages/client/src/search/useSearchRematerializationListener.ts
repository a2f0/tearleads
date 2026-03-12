import type { SearchableDocument } from '@tearleads/app-search';
import { getSearchStoreForInstance } from '@tearleads/app-search';
import { useEffect } from 'react';
import { VFS_REMATERIALIZATION_COMPLETE_EVENT } from '@/lib/vfsRematerializationEvents';

/**
 * Listens for VFS rematerialization events and triggers a full
 * search index rebuild so post-login content becomes searchable.
 */
export function useSearchRematerializationListener(
  currentInstanceId: string | null,
  fetchDocs: () => Promise<SearchableDocument[]>
): void {
  useEffect(() => {
    if (!currentInstanceId) {
      return;
    }

    const handleRematerialization = () => {
      const store = getSearchStoreForInstance(currentInstanceId);
      if (!store.getState().isInitialized) {
        return;
      }
      void store.rebuildFromDatabase(fetchDocs).catch((err) => {
        console.error(
          'Search: Failed to rebuild after rematerialization:',
          err
        );
      });
    };

    window.addEventListener(
      VFS_REMATERIALIZATION_COMPLETE_EVENT,
      handleRematerialization
    );
    return () => {
      window.removeEventListener(
        VFS_REMATERIALIZATION_COMPLETE_EVENT,
        handleRematerialization
      );
    };
  }, [currentInstanceId, fetchDocs]);
}
