import type { VfsOpenItem } from '@tearleads/vfs-explorer';
import { VfsWindow as VfsWindowBase } from '@tearleads/vfs-explorer';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import { useCallback } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ClientVfsExplorerProvider } from '@/contexts/ClientVfsExplorerProvider';
import type { WindowOpenRequestPayloads } from '@/contexts/WindowManagerContext';
import { useWindowManagerActions } from '@/contexts/WindowManagerContext';
import { useDatabaseContext } from '@/db/hooks';
import { useVfsUploader } from '@/hooks/vfs';
import { resolveFileOpenTarget, resolvePlaylistType } from '@/lib/vfsOpen';

interface VfsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

/**
 * VfsWindow wrapped with ClientVfsExplorerProvider.
 * This provides all the dependencies (database, UI components, VFS keys, auth)
 * required by the @tearleads/vfs-explorer package.
 */
export function VfsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: VfsWindowProps) {
  const { isUnlocked, isLoading: isDatabaseLoading } = useDatabaseContext();
  const { openWindow, requestWindowOpen } = useWindowManagerActions();
  const { fileInputRef, refreshToken, handleUpload, handleFileInputChange } =
    useVfsUploader();

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
          openWithPayload('contacts', { groupId: id });
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

  const windowProps = {
    id,
    onClose,
    onMinimize,
    onDimensionsChange,
    onRename,
    onFocus,
    zIndex,
    initialDimensions
  };

  // Show lock screen when database is loading or locked
  if (isDatabaseLoading || !isUnlocked) {
    return (
      <FloatingWindow
        {...windowProps}
        {...(initialDimensions && { initialDimensions })}
        title="VFS Explorer"
        defaultWidth={900}
        defaultHeight={600}
        minWidth={600}
        minHeight={400}
      >
        <div className="flex h-full flex-col">
          <WindowControlBar>{null}</WindowControlBar>
          {isDatabaseLoading && (
            <div className="flex flex-1 items-center justify-center rounded-lg border p-8 text-center text-muted-foreground">
              Loading database...
            </div>
          )}

          {!isDatabaseLoading && !isUnlocked && (
            <div className="flex flex-1 items-center justify-center p-4">
              <InlineUnlock description="VFS explorer" />
            </div>
          )}
        </div>
      </FloatingWindow>
    );
  }

  return (
    <ClientVfsExplorerProvider>
      <VfsWindowBase
        {...windowProps}
        onItemOpen={handleItemOpen}
        onUpload={handleUpload}
        refreshToken={refreshToken}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="vfs-file-input"
      />
    </ClientVfsExplorerProvider>
  );
}
