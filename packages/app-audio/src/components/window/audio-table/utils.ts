/**
 * Utility functions for audio table view.
 */

export function getAudioTypeDisplay(mimeType: string): string {
  const typeMap: Record<string, string> = {
    'audio/mpeg': 'MP3',
    'audio/wav': 'WAV',
    'audio/ogg': 'OGG',
    'audio/flac': 'FLAC',
    'audio/aac': 'AAC',
    'audio/mp4': 'M4A',
    'audio/x-m4a': 'M4A',
    'audio/webm': 'WebM'
  };

  if (typeMap[mimeType]) {
    return typeMap[mimeType];
  }

  const subtype = mimeType.split('/')[1];
  return subtype?.toUpperCase() ?? 'Audio';
}
