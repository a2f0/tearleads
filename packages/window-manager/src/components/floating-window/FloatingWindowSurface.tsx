import { cn } from '../../lib/utils.js';
import { buildFloatingWindowStyles } from './windowStyles.js';

export interface FloatingWindowStyleProps {
  isDesktop: boolean;
  isMaximized: boolean;
  isNearMaximized: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  zIndex: number;
  maxWidthPercent: number;
  maxHeightPercent: number;
}

interface FloatingWindowSurfaceProps {
  windowRef: React.RefObject<HTMLDivElement | null>;
  id: string;
  title: string;
  styleProps: FloatingWindowStyleProps;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}

export function FloatingWindowSurface({
  windowRef,
  id,
  title,
  styleProps,
  onClick,
  children
}: FloatingWindowSurfaceProps) {
  const { isDesktop, isMaximized } = styleProps;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Window focus on click
    <div
      ref={windowRef}
      className={cn(
        'floating-window fixed flex flex-col overflow-hidden border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80',
        isDesktop && !isMaximized && 'rounded-lg',
        !isDesktop && 'inset-x-0 bottom-0 rounded-t-lg'
      )}
      style={buildFloatingWindowStyles(styleProps)}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      onClick={onClick}
      data-testid={`floating-window-${id}`}
      data-maximized={isMaximized}
    >
      {children}
    </div>
  );
}
