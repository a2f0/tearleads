import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import type { ReactNode } from 'react';
import { BusinessesWindowMenuBar } from './BusinessesWindowMenuBar.js';

const BUSINESSES_WINDOW_DEFAULT_WIDTH = 860;
const BUSINESSES_WINDOW_DEFAULT_HEIGHT = 560;
const BUSINESSES_WINDOW_MIN_WIDTH = 620;
const BUSINESSES_WINDOW_MIN_HEIGHT = 420;

export interface BusinessesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
  children?: ReactNode;
}

export function BusinessesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  children
}: BusinessesWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Businesses"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={BUSINESSES_WINDOW_DEFAULT_WIDTH}
      defaultHeight={BUSINESSES_WINDOW_DEFAULT_HEIGHT}
      minWidth={BUSINESSES_WINDOW_MIN_WIDTH}
      minHeight={BUSINESSES_WINDOW_MIN_HEIGHT}
    >
      <div className="flex h-full min-h-0 flex-col">
        <BusinessesWindowMenuBar onClose={onClose} />
        <WindowControlBar>{null}</WindowControlBar>
        <div className="min-h-0 flex-1 p-3">{children}</div>
      </div>
    </FloatingWindow>
  );
}
