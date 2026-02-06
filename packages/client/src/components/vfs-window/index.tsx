import type { VfsOpenItem } from '@rapid/vfs-explorer';
import { VfsWindow as VfsWindowBase } from '@rapid/vfs-explorer';
import type { WindowDimensions } from '@rapid/window-manager';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FloatingWindow } from '@/components/floating-window';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ClientVfsExplorerProvider } from '@/contexts/ClientVfsExplorerProvider';
import type { WindowOpenRequestPayloads } from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { useDatabaseContext } from '@/db/hooks';
import { useFileUpload } from '@/hooks/useFileUpload';
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
  const { isUnlocked, isLoading: isDatabaseLoading } = useDatabaseContext();
  const { openWindow, requestWindowOpen } = useWindowManager();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile } = useFileUpload();
  const [refreshToken, setRefreshToken] = useState(0);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        await Promise.all(
          files.map(async (file) => {
            try {
              await uploadFile(file);
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
              toast.error(`Failed to upload ${file.name}. Please try again.`);
            }
          })
        );
        setRefreshToken((value) => value + 1);
      }
      e.target.value = '';
    },
    [uploadFile]
  );

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

  const windowProps = {
    id,
    onClose,
    onMinimize,
    onDimensionsChange,
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
