import { useWindowManager } from '@/contexts/WindowManagerContext';
import { TaskbarButton } from './TaskbarButton';

interface TaskbarProps {
  className?: string;
}

export function Taskbar({ className }: TaskbarProps) {
  const { windows, focusWindow, minimizeWindow, restoreWindow } =
    useWindowManager();

  if (windows.length === 0) {
    return null;
  }

  const sortedWindows = [...windows].sort((a, b) => a.zIndex - b.zIndex);
  const visibleWindows = sortedWindows.filter((w) => !w.isMinimized);
  const topWindowId = visibleWindows[visibleWindows.length - 1]?.id;

  const handleClick = (windowId: string, isMinimized: boolean) => {
    if (isMinimized) {
      restoreWindow(windowId);
    } else if (windowId === topWindowId) {
      minimizeWindow(windowId);
    } else {
      focusWindow(windowId);
    }
  };

  return (
    <div className={className} data-testid="taskbar">
      <div className="flex items-center gap-1">
        {sortedWindows.map((window) => (
          <TaskbarButton
            key={window.id}
            type={window.type}
            isActive={window.id === topWindowId && !window.isMinimized}
            isMinimized={window.isMinimized}
            onClick={() => handleClick(window.id, window.isMinimized)}
          />
        ))}
      </div>
    </div>
  );
}
