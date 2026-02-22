import type { PluginListenerHandle } from '@capacitor/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

type TransportControlAction =
  | 'play'
  | 'pause'
  | 'togglePlayPause'
  | 'next'
  | 'previous'
  | 'stop'
  | 'seekTo';

interface TransportControlEvent {
  action: TransportControlAction;
  positionMs?: number;
  mediaId?: string;
}

interface UpdatePlaybackStateOptions {
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
}

interface UpdateMetadataOptions {
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
}

interface MediaCatalogTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
}

interface MediaSessionBridgePlugin {
  updatePlaybackState(options: UpdatePlaybackStateOptions): Promise<void>;
  updateMetadata(options: UpdateMetadataOptions): Promise<void>;
  updateCatalog(options: { tracks: MediaCatalogTrack[] }): Promise<void>;
  clearMetadata(): Promise<void>;
  addListener(
    eventName: 'transportControl',
    listenerFunc: (event: TransportControlEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const MediaSessionBridge =
  registerPlugin<MediaSessionBridgePlugin>('MediaSessionBridge');

export function isAndroidNativePlatform(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
