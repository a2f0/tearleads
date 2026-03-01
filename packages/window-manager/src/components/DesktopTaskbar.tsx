import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { cn } from '@tearleads/ui';
import { DesktopTaskbarButton } from './DesktopTaskbarButton.js';
import type { WindowDimensions } from './FloatingWindow.js';

export interface DesktopTaskbarWindow {
  id: string;
  type: string;
  zIndex: number;
  isMinimized: boolean;
  title?: string | undefined;
  dimensions?: WindowDimensions | undefined;
}

export interface DesktopTaskbarProps {
  /** Array of windows to display in the taskbar */
  windows: DesktopTaskbarWindow[];
  /** Get icon for a window type */
  getIcon: (type: string) => ReactNode;
  /** Get label for a window (type and optional title) */
  getLabel: (type: string, title?: string) => string;
  /** Height of the footer/taskbar area (used for maximize calculations) */
  footerHeight: number;
  /** Called when a window should be focused */
  onFocusWindow: (id: string) => void;
  /** Called when a window should be closed */
  onCloseWindow: (id: string) => void;
  /** Called when a window should be minimized */
  onMinimizeWindow: (id: string, dimensions?: WindowDimensions) => void;
  /** Called when a window should be restored */
  onRestoreWindow: (id: string) => void;
  /** Called when window dimensions should be updated */
  onUpdateWindowDimensions: (id: string, dimensions: WindowDimensions) => void;
  /** Optional className for the taskbar container */
  className?: string | undefined;
  /** Optional context menu handler */
  onContextMenu?:
    | ((event: React.MouseEvent<HTMLDivElement>) => void)
    | undefined;
}

export function DesktopTaskbar({
  windows,
  getIcon,
  getLabel,
  footerHeight,
  onFocusWindow,
  onCloseWindow,
  onMinimizeWindow,
  onRestoreWindow,
  onUpdateWindowDimensions,
  className,
  onContextMenu
}: DesktopTaskbarProps) {
  const sortedWindows = [...windows].sort((a, b) => a.zIndex - b.zIndex);
  const visibleWindows = sortedWindows.filter((w) => !w.isMinimized);
  const topWindowId = visibleWindows[visibleWindows.length - 1]?.id;

  const handleClick = useCallback(
    (windowId: string, isMinimized: boolean) => {
      if (isMinimized) {
        onRestoreWindow(windowId);
      } else if (windowId === topWindowId) {
        const targetWindow = windows.find((w) => w.id === windowId);
        onMinimizeWindow(windowId, targetWindow?.dimensions);
      } else {
        onFocusWindow(windowId);
      }
    },
    [onFocusWindow, onMinimizeWindow, onRestoreWindow, topWindowId, windows]
  );

  const handleMinimize = useCallback(
    (windowId: string) => {
      const targetWindow = windows.find((w) => w.id === windowId);
      onMinimizeWindow(windowId, targetWindow?.dimensions);
    },
    [onMinimizeWindow, windows]
  );

  const handleMaximize = useCallback(
    (windowId: string) => {
      const targetWindow = windows.find((w) => w.id === windowId);
      if (!targetWindow) {
        return;
      }

      const preMaximizeDimensions = (() => {
        const { dimensions } = targetWindow;
        if (dimensions?.preMaximizeDimensions) {
          return dimensions.preMaximizeDimensions;
        }
        if (dimensions && !dimensions.isMaximized) {
          const { width, height, x, y } = dimensions;
          return { width, height, x, y };
        }
        return undefined;
      })();

      onUpdateWindowDimensions(windowId, {
        width: window.innerWidth,
        height: window.innerHeight - footerHeight,
        x: 0,
        y: 0,
        isMaximized: true,
        ...(preMaximizeDimensions && { preMaximizeDimensions })
      });
      onRestoreWindow(windowId);
    },
    [onRestoreWindow, onUpdateWindowDimensions, windows, footerHeight]
  );

  const hasWindows = windows.length > 0;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on taskbar
    <div
      className={cn('min-h-6', className)}
      data-testid="taskbar"
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center gap-1">
        {hasWindows &&
          sortedWindows.map((windowInstance) => (
            <DesktopTaskbarButton
              key={windowInstance.id}
              windowId={windowInstance.id}
              type={windowInstance.type}
              icon={getIcon(windowInstance.type)}
              label={getLabel(windowInstance.type, windowInstance.title)}
              isActive={
                windowInstance.id === topWindowId && !windowInstance.isMinimized
              }
              isMinimized={windowInstance.isMinimized}
              onClick={() =>
                handleClick(windowInstance.id, windowInstance.isMinimized)
              }
              onMinimize={() => handleMinimize(windowInstance.id)}
              onClose={() => onCloseWindow(windowInstance.id)}
              onMaximize={() => handleMaximize(windowInstance.id)}
            />
          ))}
      </div>
    </div>
  );
}
