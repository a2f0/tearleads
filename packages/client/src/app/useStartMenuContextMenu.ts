import { useCallback, useMemo, useState } from 'react';

interface StartMenuContextMenuState {
  x: number;
  y: number;
  showLockAction: boolean;
}

export function useStartMenuContextMenu() {
  const [contextMenu, setContextMenu] =
    useState<StartMenuContextMenuState | null>(null);

  const handleStartMenuContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        showLockAction: true
      });
    },
    []
  );

  const handleStartBarContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        showLockAction: true
      });
    },
    []
  );

  const handleTaskbarContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        showLockAction: false
      });
    },
    []
  );

  const handleFooterContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('[data-testid="start-bar"]')
      ) {
        return;
      }
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        showLockAction: false
      });
    },
    []
  );

  const close = useCallback(() => {
    setContextMenu(null);
  }, []);

  return useMemo(
    () => ({
      contextMenu,
      close,
      handleStartMenuContextMenu,
      handleStartBarContextMenu,
      handleTaskbarContextMenu,
      handleFooterContextMenu
    }),
    [
      contextMenu,
      close,
      handleStartMenuContextMenu,
      handleStartBarContextMenu,
      handleTaskbarContextMenu,
      handleFooterContextMenu
    ]
  );
}
