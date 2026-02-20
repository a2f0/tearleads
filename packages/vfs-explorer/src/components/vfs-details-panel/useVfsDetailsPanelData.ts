/**
 * Hook for VfsDetailsPanel data fetching.
 */

import { useEffect } from 'react';
import {
  ALL_ITEMS_FOLDER_ID,
  SHARED_BY_ME_FOLDER_ID,
  SHARED_WITH_ME_FOLDER_ID,
  TRASH_FOLDER_ID,
  UNFILED_FOLDER_ID
} from '../../constants';
import {
  useVfsAllItems,
  useVfsFolderContents,
  useVfsSharedByMe,
  useVfsSharedWithMe,
  useVfsTrashItems,
  useVfsUnfiledItems
} from '../../hooks';
import type { VfsSortState } from '../../lib';

interface UseVfsDetailsPanelDataOptions {
  folderId: string | null;
  sort: VfsSortState;
  refreshToken?: number | undefined;
}

export function useVfsDetailsPanelData({
  folderId,
  sort,
  refreshToken
}: UseVfsDetailsPanelDataOptions) {
  // Virtual folder detection
  const isUnfiled = folderId === UNFILED_FOLDER_ID || folderId === null;
  const isAllItems = folderId === ALL_ITEMS_FOLDER_ID;
  const isSharedByMe = folderId === SHARED_BY_ME_FOLDER_ID;
  const isSharedWithMe = folderId === SHARED_WITH_ME_FOLDER_ID;
  const isTrash = folderId === TRASH_FOLDER_ID;
  const isVirtualFolder =
    isUnfiled || isAllItems || isSharedByMe || isSharedWithMe || isTrash;

  // Use the appropriate hook based on selection
  const folderContents = useVfsFolderContents(
    isVirtualFolder ? null : folderId,
    sort
  );
  const unfiledItems = useVfsUnfiledItems(sort);
  const allItems = useVfsAllItems({ enabled: isAllItems, sort });
  const sharedByMe = useVfsSharedByMe({ enabled: isSharedByMe, sort });
  const sharedWithMe = useVfsSharedWithMe({ enabled: isSharedWithMe, sort });
  const trashItems = useVfsTrashItems({ enabled: isTrash, sort });

  // Refetch when refreshToken changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch functions are stable, including full objects causes infinite loops
  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0) {
      if (isSharedByMe) {
        sharedByMe.refetch();
      } else if (isSharedWithMe) {
        sharedWithMe.refetch();
      } else if (isTrash) {
        trashItems.refetch();
      } else if (isAllItems) {
        allItems.refetch();
      } else if (isUnfiled) {
        unfiledItems.refetch();
      } else {
        folderContents.refetch();
      }
    }
  }, [refreshToken]);

  // Select the appropriate data source
  const dataSource = (() => {
    if (isSharedByMe) return sharedByMe;
    if (isSharedWithMe) return sharedWithMe;
    if (isTrash) return trashItems;
    if (isAllItems) return allItems;
    if (isUnfiled) return unfiledItems;
    return folderContents;
  })();

  return {
    items: dataSource.items,
    loading: dataSource.loading,
    error: dataSource.error,
    isUnfiled,
    isAllItems,
    isSharedByMe,
    isSharedWithMe,
    isTrash,
    isVirtualFolder
  };
}
