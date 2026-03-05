/**
 * Inline login component that displays a login form.
 * Used on pages that require authentication when the user is not logged in.
 * Styled to match InlineUnlock for visual consistency.
 */

import { User } from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWindowManagerActions } from '@/contexts/WindowManagerContext';
import { useIsMobile } from '@/hooks/device';
import { LoginForm } from './LoginForm';

interface InlineLoginProps {
  /** Description of what will be accessible after logging in */
  description?: string;
}

export function InlineLogin({
  description = 'this feature'
}: InlineLoginProps) {
  const windowManagerActions = useWindowManagerActions();
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

  const handleSyncLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isDesktopMode) {
        return;
      }
      event.preventDefault();
      windowManagerActions.openWindow('sync');
    },
    [isDesktopMode, windowManagerActions]
  );

  return (
    <div
      className="rounded-lg border bg-background p-8 text-center [border-color:var(--soft-border)]"
      data-testid="inline-login"
    >
      <User className="mx-auto h-12 w-12 text-muted-foreground/50" />
      <p className="mt-4 text-muted-foreground">
        Sign in required to access {description}.
      </p>

      <div className="mx-auto mt-6 max-w-xs">
        <LoginForm title="" description="" borderless />
      </div>

      <p className="mt-4 text-center text-muted-foreground text-sm">
        Don&apos;t have an account?{' '}
        <Link
          to="/sync"
          onClick={handleSyncLinkClick}
          className="font-medium text-primary hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
