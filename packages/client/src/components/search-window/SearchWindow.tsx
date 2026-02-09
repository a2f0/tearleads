import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { SearchWindowContent } from './SearchWindowContent';
import {
  SearchWindowMenuBar,
  type SearchViewMode
} from './SearchWindowMenuBar';

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 500;
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const MAX_WIDTH_PERCENT = 0.9;
const MAX_HEIGHT_PERCENT = 0.9;

interface SearchWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function SearchWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: SearchWindowProps) {
  const [viewMode, setViewMode] = useState<SearchViewMode>('view');

  return (
    <FloatingWindow
      id={id}
      title="Search"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={DEFAULT_WIDTH}
      defaultHeight={DEFAULT_HEIGHT}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      maxWidthPercent={MAX_WIDTH_PERCENT}
      maxHeightPercent={MAX_HEIGHT_PERCENT}
    >
      <div className="flex h-full flex-col">
        <SearchWindowMenuBar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onClose={onClose}
        />
        <SearchWindowContent viewMode={viewMode} />
      </div>
    </FloatingWindow>
  );
}
