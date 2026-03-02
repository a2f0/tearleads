import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import {
  type WindowType,
  useWindowManagerActions
} from '@/contexts/WindowManagerContext';
import { useIsMobile } from '@/hooks/device';

export function useDesktopWindowLinkHandler(windowType: WindowType) {
  const { openWindow } = useWindowManagerActions();
  const isMobileScreen = useIsMobile();
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const pointerQuery = window.matchMedia('(pointer: coarse)');
    const updateTouchState = () => {
      const hasTouch = pointerQuery.matches || navigator.maxTouchPoints > 0;
      setIsTouchDevice(hasTouch);
    };

    updateTouchState();
    pointerQuery.addEventListener('change', updateTouchState);
    return () => {
      pointerQuery.removeEventListener('change', updateTouchState);
    };
  }, []);

  const isDesktopMode = !isMobileScreen && !isTouchDevice;

  return useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isDesktopMode) {
        return;
      }

      event.preventDefault();
      openWindow(windowType);
    },
    [isDesktopMode, openWindow, windowType]
  );
}
