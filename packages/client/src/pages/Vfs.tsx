import { VfsExplorer } from '@rapid/vfs-explorer';
import { BackLink } from '@/components/ui/back-link';
import { ClientVfsExplorerProvider } from '@/contexts/ClientVfsExplorerProvider';

export function Vfs() {
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
          <VfsExplorer className="h-full" />
        </div>
      </div>
    </ClientVfsExplorerProvider>
  );
}
