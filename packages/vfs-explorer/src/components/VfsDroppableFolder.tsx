import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { cn } from '../lib';

interface VfsDroppableFolderProps {
  folderId: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export function VfsDroppableFolder({
  folderId,
  disabled = false,
  children,
  className = ''
}: VfsDroppableFolderProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `folder-${folderId}`,
    data: { folderId },
    disabled
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        isOver && !disabled && 'bg-primary/10 ring-2 ring-primary ring-inset'
      )}
    >
      {children}
    </div>
  );
}
