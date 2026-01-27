import { FileIcon, Folder, ImageIcon, StickyNote, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VfsViewMode } from './VfsExplorer';

export type VfsObjectType = 'folder' | 'contact' | 'note' | 'file' | 'photo';

export interface VfsItem {
  id: string;
  linkId: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

interface VfsDetailsPanelProps {
  folderId: string | null;
  viewMode?: VfsViewMode | undefined;
  compact?: boolean | undefined;
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

export function VfsDetailsPanel({
  folderId,
  viewMode = 'list',
  compact: _compact
}: VfsDetailsPanelProps) {
  // Mock data for now - will be replaced with useVfsFolderContents hook
  const items: VfsItem[] = folderId
    ? [
        {
          id: '1',
          linkId: 'link-1',
          objectType: 'folder',
          name: 'Subfolder',
          createdAt: new Date()
        },
        {
          id: '2',
          linkId: 'link-2',
          objectType: 'contact',
          name: 'John Doe',
          createdAt: new Date()
        },
        {
          id: '3',
          linkId: 'link-3',
          objectType: 'note',
          name: 'Meeting Notes',
          createdAt: new Date()
        },
        {
          id: '4',
          linkId: 'link-4',
          objectType: 'file',
          name: 'document.pdf',
          createdAt: new Date()
        },
        {
          id: '5',
          linkId: 'link-5',
          objectType: 'photo',
          name: 'vacation.jpg',
          createdAt: new Date()
        }
      ]
    : [];

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

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Folder className="mx-auto h-12 w-12 opacity-50" />
          <p className="mt-2 text-sm">This folder is empty</p>
          <p className="mt-1 text-xs">Use &quot;Link Item&quot; to add items</p>
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
                  <tr
                    key={item.id}
                    className="cursor-pointer border-b hover:bg-accent/50"
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
                  </tr>
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
                <div
                  key={item.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/50"
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
