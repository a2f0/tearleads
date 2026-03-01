import { cn } from '@tearleads/ui';
import type { ReactNode } from 'react';

export interface DesktopStartBarProps {
  /** Content to render in the start bar (typically DesktopStartButton and DesktopTaskbar) */
  children: ReactNode;
  /** Called on right-click of the start bar background */
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
  /** Optional additional className */
  className?: string;
}

export function DesktopStartBar({
  children,
  onContextMenu,
  className
}: DesktopStartBarProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on start bar
    <section
      className={cn('flex items-center gap-2', className)}
      onContextMenu={onContextMenu}
      data-testid="start-bar"
    >
      {children}
    </section>
  );
}
