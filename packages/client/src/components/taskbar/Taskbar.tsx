import { DesktopTaskbar } from '@tearleads/window-manager';
import { FOOTER_HEIGHT } from '@/constants/layout';
import { getWindowIcon, getWindowLabel } from '@/constants/windowIcons';
import { useWindowManager } from '@/contexts/WindowManagerContext';

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

  return (
    <DesktopTaskbar
      windows={windows}
      getIcon={getWindowIcon}
      getLabel={getWindowLabel}
      footerHeight={FOOTER_HEIGHT}
      onFocusWindow={focusWindow}
      onCloseWindow={closeWindow}
      onMinimizeWindow={minimizeWindow}
      onRestoreWindow={restoreWindow}
      onUpdateWindowDimensions={updateWindowDimensions}
      className={className}
      onContextMenu={onContextMenu}
    />
  );
}
