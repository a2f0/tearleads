import {
  FileBox,
  FileIcon,
  Folder,
  ImageIcon,
  Loader2,
  StickyNote,
  User
} from 'lucide-react';
import { useEffect } from 'react';
import {
  useVfsFolderContents,
  useVfsUnfiledItems,
  type VfsItem,
  type VfsObjectType
} from '../hooks';
import { cn } from '../lib';
import { VfsDraggableItem } from './VfsDraggableItem';
import type { VfsViewMode } from './VfsExplorer';
import { UNFILED_FOLDER_ID } from './VfsTreePanel';

export type { VfsItem, VfsObjectType };

interface VfsDetailsPanelProps {
  folderId: string | null;
  viewMode?: VfsViewMode | undefined;
  compact?: boolean | undefined;
  refreshToken?: number | undefined;
}

const OBJECT_TYPE_ICONS: Record<VfsObjectType, typeof Folder> = {
  folder: Folder,
  contact: User,
  note: StickyNote,
  file: FileIcon,
  photo: ImageIcon
};

const OBJECT_TYPE_COLORS: Record<VfsObjectType, string> = {
  folder: 'text-yellow-600 dark:text-yellow-500',
  contact: 'text-blue-600 dark:text-blue-400',
  note: 'text-amber-600 dark:text-amber-400',
  file: 'text-gray-600 dark:text-gray-400',
  photo: 'text-green-600 dark:text-green-400'
};

// Convert unfiled items to the same shape as folder contents
interface DisplayItem {
  id: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
}

export function VfsDetailsPanel({
  folderId,
  viewMode = 'list',
  compact: _compact,
  refreshToken
}: VfsDetailsPanelProps) {
  const isUnfiled = folderId === UNFILED_FOLDER_ID;

  // Use the appropriate hook based on selection
  const folderContents = useVfsFolderContents(isUnfiled ? null : folderId);
  const unfiledItems = useVfsUnfiledItems();

  // Refetch when refreshToken changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch functions are stable, including full objects causes infinite loops
  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0) {
      if (isUnfiled) {
        unfiledItems.refetch();
      } else {
        folderContents.refetch();
      }
    }
  }, [refreshToken]);

  // Select the appropriate data source
  const items: DisplayItem[] = isUnfiled
    ? unfiledItems.items
    : folderContents.items;
  const loading = isUnfiled ? unfiledItems.loading : folderContents.loading;
  const error = isUnfiled ? unfiledItems.error : folderContents.error;

  if (!folderId) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Folder className="mx-auto h-12 w-12 opacity-50" />
          <p className="mt-2 text-sm">Select a folder to view its contents</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-destructive">
        <div className="text-center">
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          {isUnfiled ? (
            <>
              <FileBox className="mx-auto h-12 w-12 opacity-50" />
              <p className="mt-2 text-sm">No unfiled items</p>
              <p className="mt-1 text-xs">
                Uploaded files will appear here until organized
              </p>
            </>
          ) : (
            <>
              <Folder className="mx-auto h-12 w-12 opacity-50" />
              <p className="mt-2 text-sm">This folder is empty</p>
              <p className="mt-1 text-xs">
                Use &quot;Link Item&quot; to add items
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'table' ? (
          <table className="w-full">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const Icon = OBJECT_TYPE_ICONS[item.objectType];
                const colorClass = OBJECT_TYPE_COLORS[item.objectType];
                return (
                  <VfsDraggableItem
                    key={item.id}
                    item={item}
                    asTableRow
                    className="cursor-grab border-b hover:bg-accent/50"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('h-4 w-4 shrink-0', colorClass)} />
                        <span className="truncate text-sm">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-muted-foreground text-xs capitalize">
                        {item.objectType}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-muted-foreground text-xs">
                        {item.createdAt.toLocaleDateString()}
                      </span>
                    </td>
                  </VfsDraggableItem>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="space-y-1 p-2">
            {items.map((item) => {
              const Icon = OBJECT_TYPE_ICONS[item.objectType];
              const colorClass = OBJECT_TYPE_COLORS[item.objectType];
              return (
                <VfsDraggableItem
                  key={item.id}
                  item={item}
                  className="flex cursor-grab items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/50"
                >
                  <Icon className={cn('h-5 w-5 shrink-0', colorClass)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">
                      {item.name}
                    </div>
                    <div className="text-muted-foreground text-xs capitalize">
                      {item.objectType} &middot;{' '}
                      {item.createdAt.toLocaleDateString()}
                    </div>
                  </div>
                </VfsDraggableItem>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
