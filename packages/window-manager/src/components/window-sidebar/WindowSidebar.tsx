import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { useResizableSidebar } from '../../hooks/useResizableSidebar.js';
import { cn } from '@tearleads/ui';
import { WindowSidebarProvider } from './WindowSidebarContext.js';
import type { WindowSidebarContextValue } from './WindowSidebarContext.js';

const ANIMATION_DURATION_MS = 300;

export interface WindowSidebarProps {
  children: React.ReactNode;
  width: number;
  onWidthChange: (width: number) => void;
  ariaLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  'data-testid'?: string;
  minWidth?: number;
  maxWidth?: number;
  resizeFrom?: 'left' | 'right';
}

export function WindowSidebar({
  children,
  width,
  onWidthChange,
  ariaLabel,
  open,
  onOpenChange,
  'data-testid': testId = 'window-sidebar',
  minWidth = 150,
  maxWidth = 400,
  resizeFrom = 'right'
}: WindowSidebarProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobileDrawer
        open={open}
        onOpenChange={onOpenChange}
        ariaLabel={ariaLabel}
        testId={testId}
      >
        {children}
      </MobileDrawer>
    );
  }

  return (
    <DesktopSidebar
      width={width}
      onWidthChange={onWidthChange}
      ariaLabel={ariaLabel}
      testId={testId}
      minWidth={minWidth}
      maxWidth={maxWidth}
      resizeFrom={resizeFrom}
    >
      {children}
    </DesktopSidebar>
  );
}

interface DesktopSidebarProps {
  children: React.ReactNode;
  width: number;
  onWidthChange: (width: number) => void;
  ariaLabel: string;
  testId: string;
  minWidth: number;
  maxWidth: number;
  resizeFrom: 'left' | 'right';
}

function DesktopSidebar({
  children,
  width,
  onWidthChange,
  ariaLabel,
  testId,
  minWidth,
  maxWidth,
  resizeFrom
}: DesktopSidebarProps) {
  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    ariaLabel: `Resize ${ariaLabel}`,
    resizeFrom,
    minWidth,
    maxWidth
  });

  const contextValue = useMemo<WindowSidebarContextValue>(
    () => ({
      closeSidebar: () => {},
      isMobileDrawer: false
    }),
    []
  );

  return (
    <WindowSidebarProvider value={contextValue}>
      <div
        className="relative flex shrink-0 flex-col border-r bg-muted/20"
        style={{ width }}
        data-testid={testId}
      >
        {children}
        <hr
          className={cn(
            'absolute top-0 bottom-0 w-1 cursor-col-resize border-0 bg-transparent hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
            resizeFrom === 'left' ? 'left-0' : 'right-0'
          )}
          {...resizeHandleProps}
        />
      </div>
    </WindowSidebarProvider>
  );
}

interface MobileDrawerProps {
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
  testId: string;
}

function MobileDrawer({
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
