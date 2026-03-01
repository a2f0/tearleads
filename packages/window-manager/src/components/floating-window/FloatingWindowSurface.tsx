import { cn } from '@tearleads/ui';
import { useEffect, useState } from 'react';
import { buildFloatingWindowStyles } from './windowStyles.js';

interface FloatingWindowStyleProps {
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

  const [isOpaqueWindows, setIsOpaqueWindows] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('opaque-windows')
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const observer = new MutationObserver(() => {
      setIsOpaqueWindows(
        document.documentElement.classList.contains('opaque-windows')
      );
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Window focus on click
    <div
      ref={windowRef}
      className={cn(
        'floating-window fixed flex flex-col overflow-hidden border shadow-lg [border-color:var(--soft-border)]',
        isOpaqueWindows
          ? 'bg-background'
          : 'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
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
