import { BackupWindow as BackupWindowBase } from '@tearleads/backups';
import type { WindowDimensions } from '@tearleads/window-manager';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useDatabaseContext } from '@/db/hooks/useDatabaseContext';

interface BackupWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function BackupWindow(props: BackupWindowProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();

  const databaseBlocker =
    !isLoading && !isUnlocked ? (
      <InlineUnlock description="backups" />
    ) : undefined;

  return <BackupWindowBase {...props} databaseBlocker={databaseBlocker} />;
}
