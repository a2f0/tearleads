import { WindowControlBar } from '@tearleads/window-manager';
import type { EntrySortOrder, TagSortOrder } from '@tearleads/classic';
import { useState } from 'react';
import { ClassicWorkspace } from '@/components/classic-workspace/ClassicWorkspace';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { ClassicWindowMenuBar } from './ClassicWindowMenuBar';

interface ClassicWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function ClassicWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: ClassicWindowProps) {
  const [tagSortOrder, setTagSortOrder] =
    useState<TagSortOrder>('user-defined');
  const [entrySortOrder, setEntrySortOrder] =
    useState<EntrySortOrder>('user-defined');

  return (
    <FloatingWindow
      id={id}
      title="Classic"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={980}
      defaultHeight={700}
      minWidth={620}
      minHeight={420}
    >
      <div className="flex h-full flex-col">
        <ClassicWindowMenuBar
          onClose={onClose}
          tagSortOrder={tagSortOrder}
          entrySortOrder={entrySortOrder}
          onTagSortOrderChange={setTagSortOrder}
          onEntrySortOrderChange={setEntrySortOrder}
        />
        <WindowControlBar>{null}</WindowControlBar>
        <div className="h-full px-3">
          <ClassicWorkspace
            tagSortOrder={tagSortOrder}
            entrySortOrder={entrySortOrder}
            onTagSortOrderChange={setTagSortOrder}
            onEntrySortOrderChange={setEntrySortOrder}
          />
        </div>
      </div>
    </FloatingWindow>
  );
}
