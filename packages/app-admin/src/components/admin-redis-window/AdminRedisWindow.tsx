import { AdminWindowMenuBar } from '@admin/components/admin-window/AdminWindowMenuBar';
import { Admin } from '@admin/pages/admin/Admin';
import {
  DesktopFloatingWindow as FloatingWindow,
  type WindowDimensions
} from '@tearleads/window-manager';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTypedTranslation } from '@/i18n';

interface AdminRedisWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  /** Whether the user is authenticated and database is unlocked */
  isUnlocked?: boolean;
  /** Whether auth state is still loading */
  isAuthLoading?: boolean;
  /** Fallback UI to show when locked (e.g., login/unlock prompts) */
  lockedFallback?: ReactNode;
}

export function AdminRedisWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  isUnlocked = true,
  isAuthLoading = false,
  lockedFallback
}: AdminRedisWindowProps) {
  const { t } = useTypedTranslation('admin');
  return (
    <FloatingWindow
      id={id}
      title={t('redisAdmin')}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={720}
      defaultHeight={600}
      minWidth={520}
      minHeight={420}
    >
      <div className="flex h-full flex-col">
        <AdminWindowMenuBar onClose={onClose} hideControlBar={!isUnlocked} />
        <div className="flex-1 overflow-auto p-3">
          {isAuthLoading ? (
            <div
              className="flex h-full items-center justify-center text-muted-foreground"
              data-testid="admin-redis-window-loading"
            >
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading...
            </div>
          ) : !isUnlocked ? (
            <div
              className="flex h-full items-center justify-center p-4"
              data-testid="admin-redis-window-locked"
            >
              {lockedFallback}
            </div>
          ) : (
            <Admin showBackLink={false} />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
