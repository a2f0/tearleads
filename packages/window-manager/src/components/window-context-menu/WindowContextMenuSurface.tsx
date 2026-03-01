import { forwardRef } from 'react';
import { cn } from '@tearleads/ui';

interface WindowContextMenuSurfaceProps {
  left: number;
  top: number;
  menuZIndex: number;
  menuClassName?: string | undefined;
  menuTestId?: string | undefined;
  children: React.ReactNode;
}

export const WindowContextMenuSurface = forwardRef<
  HTMLDivElement,
  WindowContextMenuSurfaceProps
>(function WindowContextMenuSurface(
  { left, top, menuZIndex, menuClassName, menuTestId, children },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'fixed min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md',
        menuClassName
      )}
      style={{
        left,
        top,
        zIndex: menuZIndex
      }}
      data-testid={menuTestId}
    >
      {children}
    </div>
  );
});
