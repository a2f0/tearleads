import type { VfsOpenItem } from '@rapid/vfs-explorer';
import { VfsWindow as VfsWindowBase } from '@rapid/vfs-explorer';
import type { WindowDimensions } from '@rapid/window-manager';
import { useCallback } from 'react';
import { ClientVfsExplorerProvider } from '@/contexts/ClientVfsExplorerProvider';
import type { WindowOpenRequestPayloads } from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { resolveFileOpenTarget, resolvePlaylistType } from '@/lib/vfs-open';

interface VfsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

/**
 * VfsWindow wrapped with ClientVfsExplorerProvider.
 * This provides all the dependencies (database, UI components, VFS keys, auth)
 * required by the @rapid/vfs-explorer package.
 */
export function VfsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: VfsWindowProps) {
  const { openWindow, requestWindowOpen } = useWindowManager();

  const handleItemOpen = useCallback(
    async (item: VfsOpenItem) => {
      const { objectType, id } = item;
      const openWithPayload = <K extends keyof WindowOpenRequestPayloads>(
        type: K,
        payload: WindowOpenRequestPayloads[K]
      ) => {
        openWindow(type);
        requestWindowOpen(type, payload);
      };

      switch (objectType) {
        case 'contact':
          openWithPayload('contacts', { contactId: id });
          return;
        case 'note':
          openWithPayload('notes', { noteId: id });
          return;
        case 'album':
          openWithPayload('photos', { albumId: id });
          return;
        case 'photo':
          openWithPayload('photos', { photoId: id });
          return;
        case 'audio':
          openWithPayload('audio', { audioId: id });
          return;
        case 'video':
          openWithPayload('videos', { videoId: id });
          return;
        case 'email':
        case 'emailFolder':
          openWindow('email');
          return;
        case 'playlist': {
          const playlistType = await resolvePlaylistType(id);
          if (playlistType === 'video') {
            openWithPayload('videos', { playlistId: id });
          } else {
            openWithPayload('audio', { playlistId: id });
          }
          return;
        }
        case 'contactGroup':
          openWindow('contacts');
          return;
        case 'tag':
          openWindow('files');
          return;
        case 'file': {
          const target = await resolveFileOpenTarget(id);
          switch (target) {
            case 'document':
              openWithPayload('documents', { documentId: id });
              return;
            case 'photo':
              openWithPayload('photos', { photoId: id });
              return;
            case 'audio':
              openWithPayload('audio', { audioId: id });
              return;
            case 'video':
              openWithPayload('videos', { videoId: id });
              return;
            case 'file':
              openWithPayload('files', { fileId: id });
              return;
            default:
              return;
          }
        }
        default:
          return;
      }
    },
    [openWindow, requestWindowOpen]
  );

  return (
    <ClientVfsExplorerProvider>
      <VfsWindowBase
        id={id}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onFocus={onFocus}
        zIndex={zIndex}
        initialDimensions={initialDimensions}
        onItemOpen={handleItemOpen}
      />
    </ClientVfsExplorerProvider>
  );
}
