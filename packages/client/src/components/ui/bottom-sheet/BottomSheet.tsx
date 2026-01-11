import { useCallback, useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';

export const ANIMATION_DURATION_MS = 300;

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string;
  'data-testid'?: string;
}

export function BottomSheet({
  open,
  onOpenChange,
  children,
  title,
  'data-testid': testId = 'bottom-sheet'
}: BottomSheetProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      requestAnimationFrame(() => setIsAnimating(true));
      return;
    }
    setIsAnimating(false);
    const timer = setTimeout(
      () => setShouldRender(false),
      ANIMATION_DURATION_MS
    );
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange]);

  const handleBackdropClick = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-50" data-testid={testId}>
      <div
        className={cn(
          'fixed inset-0 bg-black/50 transition-opacity duration-300',
          isAnimating ? 'opacity-100' : 'opacity-0'
        )}
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid={`${testId}-backdrop`}
      />

      <div
        className={cn(
          'fixed right-0 bottom-0 left-0 z-10 max-h-[85vh] overflow-y-auto',
          'rounded-t-2xl border-t bg-background shadow-lg',
          'transition-transform duration-300 ease-out',
          'pb-[env(safe-area-inset-bottom)]',
          isAnimating ? 'translate-y-0' : 'translate-y-full'
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        data-testid={`${testId}-content`}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        {title && (
          <h2 id={titleId} className="px-4 pb-2 font-semibold text-lg">
            {title}
          </h2>
        )}

        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
