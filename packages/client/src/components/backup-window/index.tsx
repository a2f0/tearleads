import {
  BackupWindow as BackupWindowBase,
  type BackupWindowProps as BackupWindowBaseProps
} from '@tearleads/backups';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useDatabaseContext } from '@/db/hooks/useDatabaseContext';

type BackupWindowProps = Omit<BackupWindowBaseProps, 'databaseBlocker'>;

export function BackupWindow(props: BackupWindowProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();

  const databaseBlocker =
    !isLoading && !isUnlocked ? (
      <InlineUnlock description="backups" />
    ) : undefined;

  return <BackupWindowBase {...props} databaseBlocker={databaseBlocker} />;
}
