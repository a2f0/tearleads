/**
 * Types and constants for Audio components.
 */

export const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/webm',
  'audio/aiff',
  'audio/x-aiff'
];

export interface AudioInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

export interface AudioWithUrl extends AudioInfo {
  objectUrl: string;
  thumbnailUrl: string | null;
}

export const ROW_HEIGHT_ESTIMATE = 56;

export interface AudioPageProps {
  playlistId?: string | null | undefined;
  hideBackLink?: boolean | undefined;
}
