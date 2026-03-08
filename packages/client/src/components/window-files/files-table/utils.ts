/**
 * Utility functions for FilesWindowTableView.
 */

import { FileIcon, FileText, Music } from 'lucide-react';
import { createElement } from 'react';

export function getFileIcon(mimeType: string): React.ReactElement {
  if (mimeType.startsWith('audio/')) {
    return createElement(Music, {
      className: 'h-3 w-3 shrink-0 text-muted-foreground'
    });
  }
  if (mimeType === 'application/pdf') {
    return createElement(FileText, {
      className: 'h-3 w-3 shrink-0 text-muted-foreground'
    });
  }
  return createElement(FileIcon, {
    className: 'h-3 w-3 shrink-0 text-muted-foreground'
  });
}

export function getFileTypeDisplay(mimeType: string): string {
  const typeMap: Record<string, string> = {
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/svg+xml': 'SVG',
    'audio/mpeg': 'MP3',
    'audio/wav': 'WAV',
    'audio/ogg': 'OGG',
    'audio/flac': 'FLAC',
    'video/mp4': 'MP4',
    'video/webm': 'WebM',
    'video/quicktime': 'MOV',
    'application/pdf': 'PDF',
    'text/plain': 'Text',
    'application/json': 'JSON'
  };

  if (typeMap[mimeType]) {
    return typeMap[mimeType];
  }

  const [type, subtype] = mimeType.split('/');
  if (subtype) {
    return subtype.toUpperCase();
  }
  return type?.toUpperCase() ?? 'Unknown';
}

export function isViewable(mimeType: string): boolean {
  const fileType = mimeType.split('/')[0] ?? '';
  const viewableTypes = ['image', 'audio', 'video'];
  return viewableTypes.includes(fileType) || mimeType === 'application/pdf';
}
