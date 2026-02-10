/**
 * Video Playlist Context for dependency injection.
 * Provides playlist operations for video playlists.
 */

import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';

export interface VideoPlaylist {
  id: string;
  name: string;
  trackCount: number;
  coverImageId: string | null;
  mediaType: 'audio' | 'video';
}

export interface DatabaseState {
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
}

export interface VideoPlaylistContextValue {
  /** Database state */
  databaseState: DatabaseState;
  /** Fetch playlists from the database */
  fetchPlaylists: () => Promise<VideoPlaylist[]>;
  /** Create a new playlist */
  createPlaylist: (name: string) => Promise<string>;
  /** Rename a playlist */
  renamePlaylist: (playlistId: string, newName: string) => Promise<void>;
  /** Delete a playlist */
  deletePlaylist: (playlistId: string) => Promise<void>;
  /** Add a video to a playlist */
  addTrackToPlaylist: (playlistId: string, videoId: string) => Promise<void>;
  /** Remove a video from a playlist */
  removeTrackFromPlaylist: (
    playlistId: string,
    videoId: string
  ) => Promise<void>;
  /** Get video IDs in a playlist */
  getTrackIdsInPlaylist: (playlistId: string) => Promise<string[]>;
  /** Log an error */
  logError: (message: string, details?: string) => void;
}

const VideoPlaylistContext = createContext<VideoPlaylistContextValue | null>(
  null
);

export interface VideoPlaylistProviderProps {
  children: ReactNode;
  databaseState: DatabaseState;
  fetchPlaylists: () => Promise<VideoPlaylist[]>;
  createPlaylist: (name: string) => Promise<string>;
  renamePlaylist: (playlistId: string, newName: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, videoId: string) => Promise<void>;
  removeTrackFromPlaylist: (
    playlistId: string,
    videoId: string
  ) => Promise<void>;
  getTrackIdsInPlaylist: (playlistId: string) => Promise<string[]>;
  logError: (message: string, details?: string) => void;
}

export function VideoPlaylistProvider({
  children,
  databaseState,
  fetchPlaylists,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  getTrackIdsInPlaylist,
  logError
}: VideoPlaylistProviderProps) {
  const value = useMemo<VideoPlaylistContextValue>(
    () => ({
      databaseState,
      fetchPlaylists,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      getTrackIdsInPlaylist,
      logError
    }),
    [
      databaseState,
      fetchPlaylists,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      getTrackIdsInPlaylist,
      logError
    ]
  );

  return (
    <VideoPlaylistContext.Provider value={value}>
      {children}
    </VideoPlaylistContext.Provider>
  );
}

export function useVideoPlaylistContext(): VideoPlaylistContextValue {
  const context = useContext(VideoPlaylistContext);
  if (!context) {
    throw new Error(
      'useVideoPlaylistContext must be used within a VideoPlaylistProvider'
    );
  }
  return context;
}

export function useVideoPlaylistDatabaseState(): DatabaseState {
  const { databaseState } = useVideoPlaylistContext();
  return databaseState;
}
