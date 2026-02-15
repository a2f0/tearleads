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
        // Audio namespace
        play: 'Play',
        pause: 'Pause',
        previousTrack: 'Previous track',
        nextTrack: 'Next track',
        restart: 'Restart track',
        rewind: 'Rewind',
        close: 'Close player',
        repeatOff: 'Repeat: Off',
        repeatAll: 'Repeat: All tracks',
        repeatOne: 'Repeat: Current track',
        hideVisualizer: 'Hide visualizer',
        showVisualizer: 'Show visualizer',
        mute: 'Mute',
        unmute: 'Unmute',
        volume: 'Volume',
        seek: 'Seek',
        getInfo: 'Get info',
        delete: 'Delete',
        restore: 'Restore',
        download: 'Download',
        share: 'Share',
        audio: 'Audio',
        allTracks: 'All Tracks',
        playlists: 'Playlists',
        searchTracks: 'Search tracks...',
        noAudioFiles: 'No audio files',
        audioTracks: 'audio tracks',
        audioFiles: 'audio files',
        playlistName: 'Playlist name',
        unknownAlbum: 'Unknown Album',
        clearAlbumFilter: 'Clear album filter',
        uploadProgress: 'Upload progress',
        uploading: 'Uploading...',
        audioDetails: 'Audio Details',
        metadata: 'Metadata',
        noMetadataFound: 'No embedded metadata found.',
        albumCover: 'Album cover',
        back: 'Back',
        loadingDatabase: 'Loading database...',
        loadingAudio: 'Loading audio...',
        thisAudioFile: 'this audio file',
        title: 'Title',
        artist: 'Artist',
        album: 'Album',
        albumArtist: 'Album Artist',
        year: 'Year',
        track: 'Track',
        genre: 'Genre',
        type: 'Type',
        size: 'Size',
        name: 'Name',
        date: 'Date',
        uploaded: 'Uploaded'
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
