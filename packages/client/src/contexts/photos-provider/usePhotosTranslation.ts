/**
 * Hook for photos translation function.
 */

import type { TranslationFunction } from '@tearleads/photos';
import { useCallback } from 'react';
import { useTypedTranslation } from '@/i18n';

export function usePhotosTranslation(): TranslationFunction {
  const { t: tContextMenu } = useTypedTranslation('contextMenu');
  const { t: tMenu } = useTypedTranslation('menu');
  const { t: tCommon } = useTypedTranslation('common');

  return useCallback(
    (key, options) => {
      const contextMenuKeys = [
        'getInfo',
        'delete',
        'restore',
        'download',
        'share'
      ] as const;
      const menuKeys = ['photos'] as const;
      const commonKeys = ['loading', 'create', 'cancel'] as const;

      if (contextMenuKeys.includes(key as (typeof contextMenuKeys)[number])) {
        return tContextMenu(key as 'getInfo' | 'delete', options);
      }
      if (menuKeys.includes(key as (typeof menuKeys)[number])) {
        return tMenu(key as 'photos', options);
      }
      if (commonKeys.includes(key as (typeof commonKeys)[number])) {
        return tCommon(key as 'loading' | 'create', options);
      }

      // Fallback translations for photos-specific keys
      const fallbacks: Record<string, string> = {
        addToAIChat: 'Add to AI chat',
        upload: 'Upload',
        allPhotos: 'All Photos',
        albums: 'Albums',
        searchPhotos: 'Search photos',
        noPhotos: 'No photos',
        photoCount:
          options?.['count'] === 1
            ? '1 photo'
            : `${options?.['count'] ?? 0} photos`,
        uploadProgress: 'Uploading...',
        uploading: 'Uploading',
        photoDetails: 'Photo Details',
        back: 'Back',
        loadingDatabase: 'Loading database...',
        loadingPhotos: 'Loading photos...',
        type: 'Type',
        size: 'Size',
        name: 'Name',
        date: 'Date',
        uploaded: 'Uploaded',
        newAlbum: 'New Album',
        renameAlbum: 'Rename Album',
        deleteAlbum: 'Delete Album',
        albumName: 'Album Name',
        rename: 'Rename',
        confirmDeleteAlbum: 'Are you sure you want to delete this album?'
      };

      return fallbacks[key] ?? key;
    },
    [tContextMenu, tMenu, tCommon]
  );
}
