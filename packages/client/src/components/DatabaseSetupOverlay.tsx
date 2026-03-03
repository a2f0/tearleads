import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { zIndex } from '@/constants/zIndex';
import { databaseSetupProgressStore } from '@/stores/databaseSetupProgressStore';

export function DatabaseSetupOverlay() {
  const step = useSyncExternalStore(
    (listener) => databaseSetupProgressStore.subscribe(listener),
    () => databaseSetupProgressStore.getSnapshot()
  );

  const isActive = useSyncExternalStore(
    (listener) => databaseSetupProgressStore.subscribe(listener),
    () => databaseSetupProgressStore.getIsActive()
  );

  if (!isActive || !step) return null;

  const clampedProgress = Math.max(0, Math.min(100, Math.round(step.progress)));

  return createPortal(
    <div
      data-testid="database-setup-overlay"
      className="fixed inset-0 flex items-center justify-center bg-background text-foreground"
      style={{ zIndex: zIndex.databaseSetupOverlay }}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-4 px-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-center text-sm text-muted-foreground">
          {step.label}
        </p>
        <div className="w-full">
          <div
            role="progressbar"
            aria-label="Database setup progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clampedProgress}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${clampedProgress}%` }}
            />
          </div>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            {clampedProgress}%
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
