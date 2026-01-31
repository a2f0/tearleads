import type { VfsOpenItem } from '@rapid/vfs-explorer';
import { VfsExplorer } from '@rapid/vfs-explorer';
import { useCallback } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { ClientVfsExplorerProvider } from '@/contexts/ClientVfsExplorerProvider';
import { useNavigateWithFrom } from '@/lib/navigation';
import { type FileOpenTarget, resolveFileOpenTarget } from '@/lib/vfs-open';

export function Vfs() {
  const navigateWithFrom = useNavigateWithFrom();

  const handleItemOpen = useCallback(
    async (item: VfsOpenItem) => {
      const fromLabel = 'Back to VFS Explorer';
      const pathMappings: Partial<Record<VfsOpenItem['objectType'], string>> = {
        contact: `/contacts/${item.id}`,
        note: `/notes/${item.id}`,
        album: `/photos?album=${item.id}`,
        photo: `/photos/${item.id}`,
        audio: `/audio/${item.id}`,
        video: `/videos/${item.id}`,
        email: '/email',
        emailFolder: '/email',
        contactGroup: '/contacts',
        playlist: '/audio',
        tag: '/files'
      };

      const path = pathMappings[item.objectType];
      if (path) {
        navigateWithFrom(path, { fromLabel });
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
    <ClientVfsExplorerProvider>
      <div className="flex h-full flex-col space-y-4">
        <div className="space-y-2">
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
          <h1 className="font-bold text-2xl tracking-tight">VFS Explorer</h1>
          <p className="text-muted-foreground text-sm">
            Organize and share your data with end-to-end encryption
          </p>
        </div>
        <div className="min-h-0 flex-1 rounded-lg border">
          <VfsExplorer className="h-full" onItemOpen={handleItemOpen} />
        </div>
      </div>
    </ClientVfsExplorerProvider>
  );
}
