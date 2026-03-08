import { useEffect, useState } from 'react';
import { MOBILE_BREAKPOINT } from '@/constants/breakpoints';

interface ViewportLike {
  innerWidth: number;
}

export function isViewportMobile(
  viewport: ViewportLike | undefined,
  breakpoint: number
): boolean {
  if (!viewport) {
    return false;
  }
  return viewport.innerWidth < breakpoint;
}

export function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(() =>
    isViewportMobile(globalThis.window, breakpoint)
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(isViewportMobile(window, breakpoint));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}
