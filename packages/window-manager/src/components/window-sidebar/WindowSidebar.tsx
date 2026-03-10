import { useIsMobile } from '../../hooks/useIsMobile.js';
import { DesktopSidebar } from './DesktopSidebar.js';
import { MobileDrawer } from './MobileDrawer.js';

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
