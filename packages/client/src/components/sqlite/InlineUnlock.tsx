/**
 * Inline unlock component that displays a password input and unlock button.
 * Used on pages that require database access when the database is locked.
 */

import { Database } from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWindowManagerActions } from '@/contexts/WindowManagerContext';
import { useDatabaseContext } from '@/db/hooks';
import { useIsMobile } from '@/hooks/device';
import { UnlockForm } from './UnlockForm';

interface InlineUnlockProps {
  /** Description of what will be accessible after unlocking */
  description?: string;
}

export function InlineUnlock({ description = 'content' }: InlineUnlockProps) {
  const { isSetUp, unlock, restoreSession, hasPersistedSession } =
    useDatabaseContext();
  const windowManagerActions = useWindowManagerActions();
  const isMobileScreen = useIsMobile();
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleSqliteLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isDesktopMode) {
        return;
      }
      event.preventDefault();
      windowManagerActions.openWindow('sqlite');
    },
    [isDesktopMode, windowManagerActions]
  );

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

  if (!isSetUp) {
    return (
      <div
        className="rounded-lg border bg-background p-8 text-center [border-color:var(--soft-border)]"
        data-testid="inline-unlock"
      >
        <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">
          Database is not set up. Go to the{' '}
          <Link
            to="/sqlite"
            onClick={handleSqliteLinkClick}
            className="text-primary underline"
          >
            SQLite page
          </Link>{' '}
          to set up your database.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border bg-background p-8 text-center [border-color:var(--soft-border)]"
      data-testid="inline-unlock"
    >
      <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
      <p className="mt-4 text-muted-foreground">
        Database is locked. Enter your password to view {description}.
      </p>

      <UnlockForm
        unlock={unlock}
        restoreSession={restoreSession}
        hasPersistedSession={hasPersistedSession}
        isLoading={isLoading}
        setIsLoading={setIsLoading}
        error={error}
        setError={setError}
      />

      <p className="mt-4 text-center text-muted-foreground text-sm">
        Already have an account?{' '}
        <Link
          to="/sync"
          onClick={handleSyncLinkClick}
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>

      <p className="mt-2 text-center text-muted-foreground text-sm">
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
