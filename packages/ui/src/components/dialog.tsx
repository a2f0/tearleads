import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../lib/utils.js';

const ANIMATION_DURATION_MS = 200;

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string;
  'data-testid'?: string;
}

export function Dialog({
  open,
  onOpenChange,
  children,
  title,
  'data-testid': testId = 'dialog'
}: DialogProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const titleId = useId();
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

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
        onOpenChangeRef.current(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  const handleBackdropClick = useCallback(() => {
    onOpenChangeRef.current(false);
  }, []);

  if (!shouldRender) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid={testId}
    >
      <div
        className={cn(
          'fixed inset-0 bg-black/50 transition-opacity duration-200',
          isAnimating ? 'opacity-100' : 'opacity-0'
        )}
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid={`${testId}-backdrop`}
      />

      <div
        className={cn(
          'relative z-10 w-full max-w-md overflow-hidden',
          'rounded-lg border bg-background shadow-lg',
          'transition-all duration-200',
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        data-testid={`${testId}-content`}
      >
        {title && (
          <div className="border-b px-4 py-3">
            <h2 id={titleId} className="font-semibold text-lg">
              {title}
            </h2>
          </div>
        )}

        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
