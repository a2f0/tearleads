import { vfsLinks } from '@rapid/db/sqlite';
import type { VfsOpenItem } from '@rapid/vfs-explorer';
import { VfsExplorer } from '@rapid/vfs-explorer';
import { and, eq } from 'drizzle-orm';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { ClientVfsExplorerProvider } from '@/contexts/ClientVfsExplorerProvider';
import { useDatabaseContext } from '@/db/hooks';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useNavigateWithFrom } from '@/lib/navigation';
import {
  type FileOpenTarget,
  resolveFileOpenTarget,
  resolvePlaylistType
} from '@/lib/vfs-open';

export function Vfs() {
  const { db, isUnlocked, isLoading: isDatabaseLoading } = useDatabaseContext();
  const navigateWithFrom = useNavigateWithFrom();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFolderIdRef = useRef<string | null>(null);
  const { uploadFile } = useFileUpload();
  const [refreshToken, setRefreshToken] = useState(0);

  const handleUpload = useCallback((folderId: string) => {
    currentFolderIdRef.current = folderId;
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const folderId = currentFolderIdRef.current;

      if (files.length > 0 && db) {
        await Promise.all(
          files.map(async (file) => {
            try {
              const result = await uploadFile(file);

              // Create VFS link to folder if uploading to a specific folder
              if (folderId) {
                const existing = await db
                  .select({ id: vfsLinks.id })
                  .from(vfsLinks)
                  .where(
                    and(
                      eq(vfsLinks.parentId, folderId),
                      eq(vfsLinks.childId, result.id)
                    )
                  );

                if (existing.length === 0) {
                  const linkId = crypto.randomUUID();
                  const now = new Date();
                  await db.insert(vfsLinks).values({
                    id: linkId,
                    parentId: folderId,
                    childId: result.id,
                    wrappedSessionKey: '',
                    createdAt: now
                  });
                }
              }
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
              toast.error(`Failed to upload ${file.name}. Please try again.`);
            }
          })
        );
        setRefreshToken((value) => value + 1);
      }
      currentFolderIdRef.current = null;
      e.target.value = '';
    },
    [db, uploadFile]
  );

  const handleItemOpen = useCallback(
    async (item: VfsOpenItem) => {
      const fromLabel = 'Back to VFS Explorer';
      const pathMappings: Partial<Record<VfsOpenItem['objectType'], string>> = {
        contact: `/contacts/${item.id}`,
        note: `/notes/${item.id}`,
        album: `/photos/albums/${item.id}`,
        photo: `/photos/${item.id}`,
        audio: `/audio/${item.id}`,
        video: `/videos/${item.id}`,
        email: '/email',
        emailFolder: '/email',
        contactGroup: '/contacts',
        tag: '/files'
      };

      const path = pathMappings[item.objectType];
      if (path) {
        navigateWithFrom(path, { fromLabel });
        return;
      }

      if (item.objectType === 'playlist') {
        const playlistType = await resolvePlaylistType(item.id);
        if (playlistType === 'video') {
          navigateWithFrom(`/videos/playlists/${item.id}`, { fromLabel });
        } else {
          navigateWithFrom(`/audio/playlists/${item.id}`, { fromLabel });
        }
        return;
      }

      if (item.objectType === 'file') {
        const target = await resolveFileOpenTarget(item.id);
        const filePathMappings: Record<FileOpenTarget, string> = {
          document: `/documents/${item.id}`,
          photo: `/photos/${item.id}`,
          audio: `/audio/${item.id}`,
          video: `/videos/${item.id}`,
          file: `/files/${item.id}`
        };
        navigateWithFrom(filePathMappings[target], { fromLabel });
      }
    },
    [navigateWithFrom]
  );

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <h1 className="font-bold text-2xl tracking-tight">VFS Explorer</h1>
        <p className="text-muted-foreground text-sm">
          Organize and share your data with end-to-end encryption
        </p>
      </div>

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

      {isUnlocked && (
        <ClientVfsExplorerProvider>
          <div className="min-h-0 flex-1 rounded-lg border">
            <VfsExplorer
              className="h-full"
              onItemOpen={handleItemOpen}
              onUpload={handleUpload}
              refreshToken={refreshToken}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            data-testid="vfs-file-input"
          />
        </ClientVfsExplorerProvider>
      )}
    </div>
  );
}
