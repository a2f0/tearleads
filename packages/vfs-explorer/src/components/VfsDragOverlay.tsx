import { DragOverlay } from '@dnd-kit/core';
import { FileIcon, Folder, ImageIcon, StickyNote, User } from 'lucide-react';
import type { VfsObjectType } from '../hooks';
import { cn } from '../lib';
import type { DragItemData } from './VfsDraggableItem';

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

interface VfsDragOverlayProps {
  activeItem: DragItemData | null;
}

export function VfsDragOverlay({ activeItem }: VfsDragOverlayProps) {
  if (!activeItem) {
    return <DragOverlay />;
  }

  const Icon = OBJECT_TYPE_ICONS[activeItem.objectType];
  const colorClass = OBJECT_TYPE_COLORS[activeItem.objectType];

  return (
    <DragOverlay>
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-lg">
        <Icon className={cn('h-4 w-4 shrink-0', colorClass)} />
        <span className="truncate text-sm">{activeItem.name}</span>
      </div>
    </DragOverlay>
  );
}
