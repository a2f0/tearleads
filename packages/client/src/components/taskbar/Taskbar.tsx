import { useCallback } from 'react';
import { FOOTER_HEIGHT } from '@/constants/layout';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { cn } from '@/lib/utils';
import { TaskbarButton } from './TaskbarButton';

interface TaskbarProps {
  className?: string;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export function Taskbar({ className, onContextMenu }: TaskbarProps) {
  const {
    windows,
    focusWindow,
    closeWindow,
    minimizeWindow,
    restoreWindow,
    updateWindowDimensions
  } = useWindowManager();

  const sortedWindows = [...windows].sort((a, b) => a.zIndex - b.zIndex);
  const visibleWindows = sortedWindows.filter((w) => !w.isMinimized);
  const topWindowId = visibleWindows[visibleWindows.length - 1]?.id;

  const handleClick = useCallback(
    (windowId: string, isMinimized: boolean) => {
      if (isMinimized) {
        restoreWindow(windowId);
      } else if (windowId === topWindowId) {
        minimizeWindow(windowId);
      } else {
        focusWindow(windowId);
      }
    },
    [focusWindow, minimizeWindow, restoreWindow, topWindowId]
  );

  const handleMinimize = useCallback(
    (windowId: string) => {
      const targetWindow = windows.find((window) => window.id === windowId);
      minimizeWindow(windowId, targetWindow?.dimensions);
    },
    [minimizeWindow, windows]
  );

  const handleMaximize = useCallback(
    (windowId: string) => {
      const targetWindow = windows.find((window) => window.id === windowId);
      if (!targetWindow) {
        return;
      }

      const preMaximizeDimensions =
        targetWindow.dimensions?.preMaximizeDimensions ??
        (targetWindow.dimensions && !targetWindow.dimensions.isMaximized
          ? {
              width: targetWindow.dimensions.width,
              height: targetWindow.dimensions.height,
              x: targetWindow.dimensions.x,
              y: targetWindow.dimensions.y
            }
          : undefined);

      updateWindowDimensions(windowId, {
        width: window.innerWidth,
        height: window.innerHeight - FOOTER_HEIGHT,
        x: 0,
        y: 0,
        isMaximized: true,
        ...(preMaximizeDimensions && { preMaximizeDimensions })
      });
      restoreWindow(windowId);
    },
    [restoreWindow, updateWindowDimensions, windows]
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
          sortedWindows.map((window) => (
            <TaskbarButton
              key={window.id}
              type={window.type}
              title={window.title}
              isActive={window.id === topWindowId && !window.isMinimized}
              isMinimized={window.isMinimized}
              onClick={() => handleClick(window.id, window.isMinimized)}
              onMinimize={() => handleMinimize(window.id)}
              onClose={() => closeWindow(window.id)}
              onMaximize={() => handleMaximize(window.id)}
            />
          ))}
      </div>
    </div>
  );
}
