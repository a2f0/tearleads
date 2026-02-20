/**
 * Hook for home context menu handling.
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScreensaver } from '@/components/screensaver';
import {
  useWindowManagerActions,
  type WindowType
} from '@/contexts/WindowManagerContext';
import { PATH_TO_WINDOW_TYPE } from './constants';

interface CanvasContextMenu {
  x: number;
  y: number;
}

interface IconContextMenu {
  x: number;
  y: number;
  path: string;
}

interface UseHomeContextMenuResult {
  canvasContextMenu: CanvasContextMenu | null;
  setCanvasContextMenu: React.Dispatch<
    React.SetStateAction<CanvasContextMenu | null>
  >;
  iconContextMenu: IconContextMenu | null;
  setIconContextMenu: React.Dispatch<
    React.SetStateAction<IconContextMenu | null>
  >;
  isDisplayPropertiesOpen: boolean;
  setIsDisplayPropertiesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCanvasContextMenu: (e: React.MouseEvent) => void;
  handleIconContextMenu: (e: React.MouseEvent, path: string) => void;
  handleDisplayPropertiesOpen: () => void;
  handleStartScreensaver: () => void;
  handleOpenFromContextMenu: () => void;
  handleOpenInWindow: () => void;
  handleDoubleClick: (path: string) => void;
  canOpenInWindow: (path: string) => boolean;
}

export function useHomeContextMenu(
  hasDragged: boolean
): UseHomeContextMenuResult {
  const navigate = useNavigate();
  const { openWindow } = useWindowManagerActions();
  const { activate: activateScreensaver } = useScreensaver();

  const [canvasContextMenu, setCanvasContextMenu] =
    useState<CanvasContextMenu | null>(null);
  const [iconContextMenu, setIconContextMenu] =
    useState<IconContextMenu | null>(null);
  const [isDisplayPropertiesOpen, setIsDisplayPropertiesOpen] = useState(false);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCanvasContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleIconContextMenu = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.preventDefault();
      e.stopPropagation();
      setIconContextMenu({ x: e.clientX, y: e.clientY, path });
    },
    []
  );

  const handleDisplayPropertiesOpen = useCallback(() => {
    setIsDisplayPropertiesOpen(true);
    setCanvasContextMenu(null);
  }, []);

  const handleStartScreensaver = useCallback(() => {
    activateScreensaver();
    setCanvasContextMenu(null);
  }, [activateScreensaver]);

  const handleOpenFromContextMenu = useCallback(() => {
    if (iconContextMenu) {
      navigate(iconContextMenu.path);
    }
    setIconContextMenu(null);
  }, [iconContextMenu, navigate]);

  const handleOpenInWindow = useCallback(() => {
    if (iconContextMenu) {
      const windowType = PATH_TO_WINDOW_TYPE[iconContextMenu.path];
      if (windowType) {
        openWindow(windowType as WindowType);
      }
    }
    setIconContextMenu(null);
  }, [iconContextMenu, openWindow]);

  const handleDoubleClick = useCallback(
    (path: string) => {
      if (!hasDragged) {
        const windowType = PATH_TO_WINDOW_TYPE[path];
        if (windowType) {
          openWindow(windowType as WindowType);
        } else {
          navigate(path);
        }
      }
    },
    [hasDragged, navigate, openWindow]
  );

  const canOpenInWindow = (path: string) => path in PATH_TO_WINDOW_TYPE;

  return {
    canvasContextMenu,
    setCanvasContextMenu,
    iconContextMenu,
    setIconContextMenu,
    isDisplayPropertiesOpen,
    setIsDisplayPropertiesOpen,
    handleCanvasContextMenu,
    handleIconContextMenu,
    handleDisplayPropertiesOpen,
    handleStartScreensaver,
    handleOpenFromContextMenu,
    handleOpenInWindow,
    handleDoubleClick,
    canOpenInWindow
  };
}
