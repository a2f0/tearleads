import { useCallback, useEffect, useState } from 'react';
import { DESKTOP_BREAKPOINT } from '../components/floating-window/constants.js';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined'
      ? window.innerWidth < DESKTOP_BREAKPOINT
      : false
  );

  const handleResize = useCallback(() => {
    setIsMobile(window.innerWidth < DESKTOP_BREAKPOINT);
  }, []);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  return isMobile;
}
