import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

// Mock react-i18next to return translation keys with interpolated values
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      // Map translation keys to expected text for tests
      const translations: Record<string, string> = {
        // Photos namespace
        getInfo: 'Get info',
        delete: 'Delete',
        restore: 'Restore',
        download: 'Download',
        share: 'Share',
        addToAIChat: 'Add to AI Chat',
        upload: 'Upload',
        photos: 'Photos',
        allPhotos: 'All Photos',
        albums: 'Albums',
        searchPhotos: 'Search photos...',
        noPhotos: 'No photos',
        photoCount: '{{count}} photos',
        uploadProgress: 'Upload progress',
        uploading: 'Uploading...',
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
        albumName: 'Album name',
        create: 'Create',
        cancel: 'Cancel',
        rename: 'Rename',
        confirmDeleteAlbum: 'Are you sure you want to delete this album?'
      };
      let translated = translations[key] ?? key;
      // Interpolate count values for pluralization
      if (options?.['count'] !== undefined) {
        translated = translated.replace('{{count}}', String(options['count']));
      }
      return translated;
    },
    i18n: { language: 'en' }
  })
}));

failOnConsole();

afterEach(() => {
  cleanup();
});
