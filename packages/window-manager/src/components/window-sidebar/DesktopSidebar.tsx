import { useMemo } from 'react';
import { useResizableSidebar } from '../../hooks/useResizableSidebar.js';
import { cn } from '@tearleads/ui';
import { WindowSidebarProvider } from './WindowSidebarContext.js';
import type { WindowSidebarContextValue } from './WindowSidebarContext.js';

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

export function DesktopSidebar({
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
