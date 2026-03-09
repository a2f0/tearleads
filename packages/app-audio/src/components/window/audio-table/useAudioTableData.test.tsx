import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createAlbumId } from '../../../lib/albumUtils';
import { createMockAudioTrack, createWrapper } from '../../../test/testUtils';
import { ALL_AUDIO_ID } from '../AudioPlaylistsSidebar';
import { useAudioTableData } from './useAudioTableData';

function makeMetadata({
  album,
  albumArtist
}: {
  album: string | null;
  albumArtist: string | null;
}) {
  return {
    title: null,
    artist: null,
    album,
    albumArtist,
    year: null,
    trackNumber: null,
    trackTotal: null,
    genre: null
  };
}

describe('useAudioTableData', () => {
  it('filters tracks by selected album name and artist', async () => {
    const trackA = createMockAudioTrack({
      id: 'track-a',
      name: 'Arrival - 01.mp3',
      storagePath: '/audio/track-a.mp3'
    });
    const trackB = createMockAudioTrack({
      id: 'track-b',
      name: 'Random - 01.mp3',
      storagePath: '/audio/track-b.mp3'
    });

    const fetchAudioFilesWithUrls = vi.fn(async () => [trackA, trackB]);
    const retrieveFile = vi.fn(
      async (storagePath: string) =>
        new Uint8Array(
          storagePath === '/audio/track-a.mp3' ? [1, 0, 0] : [2, 0, 0]
        )
    );
    const extractAudioMetadata = vi.fn(async (data: Uint8Array) =>
      data[0] === 1
        ? makeMetadata({ album: 'Arrival', albumArtist: 'ABBA' })
        : makeMetadata({ album: 'Other Album', albumArtist: 'Other Artist' })
    );

    const wrapper = createWrapper({
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls,
      retrieveFile,
      extractAudioMetadata
    });

    const { result } = renderHook(
      () =>
        useAudioTableData({
          selectedAlbumId: createAlbumId('Arrival', 'ABBA')
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.tracks.map((track) => track.id)).toEqual(['track-a']);
    expect(retrieveFile).toHaveBeenCalledTimes(2);
    expect(extractAudioMetadata).toHaveBeenCalledTimes(2);
  });

  it('matches album name only when selected album has no artist', async () => {
    const trackA = createMockAudioTrack({
      id: 'track-a',
      storagePath: '/audio/track-a.mp3'
    });
    const trackB = createMockAudioTrack({
      id: 'track-b',
      storagePath: '/audio/track-b.mp3'
    });
    const trackC = createMockAudioTrack({
      id: 'track-c',
      storagePath: '/audio/track-c.mp3'
    });

    const fetchAudioFilesWithUrls = vi.fn(async () => [trackA, trackB, trackC]);
    const retrieveFile = vi.fn(async (storagePath: string) => {
      if (storagePath === '/audio/track-a.mp3') {
        return new Uint8Array([1]);
      }
      if (storagePath === '/audio/track-b.mp3') {
        return new Uint8Array([2]);
      }
      return new Uint8Array([3]);
    });
    const extractAudioMetadata = vi.fn(async (data: Uint8Array) => {
      if (data[0] === 1) {
        return makeMetadata({
          album: 'Greatest Hits',
          albumArtist: 'Artist A'
        });
      }
      if (data[0] === 2) {
        return makeMetadata({
          album: 'Greatest Hits',
          albumArtist: 'Artist B'
        });
      }
      return makeMetadata({
        album: 'Different Album',
        albumArtist: 'Artist C'
      });
    });

    const wrapper = createWrapper({
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls,
      retrieveFile,
      extractAudioMetadata
    });

    const { result } = renderHook(
      () =>
        useAudioTableData({
          selectedAlbumId: createAlbumId('Greatest Hits')
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.tracks.map((track) => track.id)).toEqual([
      'track-a',
      'track-b'
    ]);
  });

  it('skips metadata extraction when no album filter is selected', async () => {
    const track = createMockAudioTrack({
      id: 'track-a',
      storagePath: '/audio/track-a.mp3'
    });
    const fetchAudioFilesWithUrls = vi.fn(async () => [track]);
    const retrieveFile = vi.fn(async () => new Uint8Array([1]));
    const extractAudioMetadata = vi.fn(async () =>
      makeMetadata({ album: 'Arrival', albumArtist: 'ABBA' })
    );

    const wrapper = createWrapper({
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls,
      retrieveFile,
      extractAudioMetadata
    });

    const { result } = renderHook(
      () =>
        useAudioTableData({
          selectedPlaylistId: ALL_AUDIO_ID
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.tracks.map((item) => item.id)).toEqual(['track-a']);
    expect(retrieveFile).not.toHaveBeenCalled();
    expect(extractAudioMetadata).not.toHaveBeenCalled();
  });
});
