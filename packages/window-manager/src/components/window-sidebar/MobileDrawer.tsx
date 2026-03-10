import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@tearleads/ui';
import { WindowSidebarProvider } from './WindowSidebarContext.js';
import type { WindowSidebarContextValue } from './WindowSidebarContext.js';

const ANIMATION_DURATION_MS = 300;

export interface MobileDrawerProps {
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
  testId: string;
}

export function MobileDrawer({
  children,
  open,
  onOpenChange,
  ariaLabel,
  testId
}: MobileDrawerProps) {
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      requestAnimationFrame(() => setIsVisible(true));
      return;
    }
    setIsVisible(false);
    const timer = setTimeout(
      () => setShouldRender(false),
      ANIMATION_DURATION_MS
    );
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange]);

  const handleBackdropClick = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const closeSidebar = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const contextValue = useMemo<WindowSidebarContextValue>(
    () => ({
      closeSidebar,
      isMobileDrawer: true
    }),
    [closeSidebar]
  );

  if (!shouldRender) return null;

  return (
    <WindowSidebarProvider value={contextValue}>
      <div className="fixed inset-0 z-50" data-testid={testId}>
        <div
          className={cn(
            'fixed inset-0 bg-black/50 transition-opacity duration-300',
            isVisible ? 'opacity-100' : 'opacity-0'
          )}
          onClick={handleBackdropClick}
          aria-hidden="true"
          data-testid={`${testId}-backdrop`}
        />
        <div
          className={cn(
            'fixed inset-y-0 left-0 z-10 flex w-[85vw] max-w-[320px] flex-col border-r bg-background shadow-lg',
            'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]',
            'transition-transform duration-300 ease-out',
            isVisible ? 'translate-x-0' : '-translate-x-full'
          )}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          data-testid={`${testId}-drawer`}
        >
          {children}
        </div>
      </div>
    </WindowSidebarProvider>
  );
}
