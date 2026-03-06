import {
  DesktopFloatingWindow,
  type WindowDimensions
} from '@tearleads/window-manager';
import { Loader2 } from 'lucide-react';
import type {
  WindowInstance,
  WindowType
} from '@/contexts/WindowManagerContext';

interface WindowBundleLoadingShellProps {
  windows: WindowInstance[];
  onClose: (id: string) => void;
  onMinimize: (id: string, dimensions: WindowDimensions) => void;
  onDimensionsChange: (
    type: WindowType,
    id: string,
    dimensions: WindowDimensions
  ) => void;
  onRename: (id: string, title: string) => void;
  onFocus: (id: string) => void;
}

function formatWindowTypeLabel(type: WindowType): string {
  return type
    .split('-')
    .map((segment) =>
      segment.length > 0
        ? segment.slice(0, 1).toUpperCase() + segment.slice(1)
        : ''
    )
    .join(' ');
}

export function WindowBundleLoadingShell({
  windows,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus
}: WindowBundleLoadingShellProps) {
  return (
    <>
      {windows.map((window) => (
        <DesktopFloatingWindow
          key={window.id}
          id={window.id}
          title={window.title ?? formatWindowTypeLabel(window.type)}
          onClose={() => onClose(window.id)}
          onMinimize={(dimensions) => onMinimize(window.id, dimensions)}
          onDimensionsChange={(dimensions) =>
            onDimensionsChange(window.type, window.id, dimensions)
          }
          onRename={(title) => onRename(window.id, title)}
          onFocus={() => onFocus(window.id)}
          zIndex={window.zIndex}
          {...(window.dimensions && { initialDimensions: window.dimensions })}
          contentClassName="flex items-center justify-center"
        >
          <div
            className="flex items-center gap-2 text-muted-foreground text-sm"
            data-testid={`window-bundle-loading-indicator-${window.id}`}
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading window assets...</span>
          </div>
        </DesktopFloatingWindow>
      ))}
    </>
  );
}
