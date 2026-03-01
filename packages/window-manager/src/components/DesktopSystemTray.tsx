import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@tearleads/ui';

export interface DesktopSystemTrayProps {
  /** Content to render in the system tray */
  children: ReactNode;
  /** Height of the footer/taskbar in pixels (used for positioning) */
  footerHeight: number;
  /** Optional additional className */
  className?: string;
  /** Optional additional style overrides */
  style?: CSSProperties;
}

export function DesktopSystemTray({
  children,
  footerHeight,
  className,
  style
}: DesktopSystemTrayProps) {
  return (
    <div
      className={cn('fixed right-4 z-50 flex h-6 items-center', className)}
      style={{
        bottom: `calc(${footerHeight / 2}px - 0.75rem + env(safe-area-inset-bottom, 0px))`,
        right: 'max(1rem, env(safe-area-inset-right, 0px))',
        ...style
      }}
      data-testid="system-tray"
    >
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
