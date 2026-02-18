import { Button } from '@tearleads/ui';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import type { BackupListItem } from './utils';
import { formatBytes, formatDate } from './utils';

interface StoredBackupsSectionProps {
  backups: BackupListItem[];
  isLoadingBackups: boolean;
  storedError: string | null;
  storageSummary: string | null;
  loadBackups: () => void;
  handleRestoreStored: (backup: BackupListItem) => void;
  handleDownload: (backup: BackupListItem) => void;
  handleDelete: (backup: BackupListItem) => void;
}

export function StoredBackupsSection({
  backups,
  isLoadingBackups,
  storedError,
  storageSummary,
  loadBackups,
  handleRestoreStored,
  handleDownload,
  handleDelete
}: StoredBackupsSectionProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-foreground text-sm">Stored Backups</h3>
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          {storageSummary && <span>{storageSummary}</span>}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadBackups()}
            disabled={isLoadingBackups}
            className="h-6 px-2 text-xs"
          >
            {isLoadingBackups ? '...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {backups.length === 0 && !isLoadingBackups && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-muted-foreground text-xs">
          No stored backups yet.
        </div>
      )}

      {backups.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
            <thead className="bg-muted/70 text-muted-foreground">
              <tr>
                <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>Name</th>
                <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>Size</th>
                <th
                  className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} text-right`}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <WindowTableRow
                  key={backup.name}
                  className="border-border border-t hover:bg-muted/40"
                >
                  <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                    <div className="text-foreground">{backup.name}</div>
                    <div className="text-muted-foreground">
                      {formatDate(backup.lastModified)}
                    </div>
                  </td>
                  <td
                    className={`${WINDOW_TABLE_TYPOGRAPHY.cell} text-muted-foreground`}
                  >
                    {formatBytes(backup.size)}
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => void handleRestoreStored(backup)}
                      >
                        Restore
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => void handleDownload(backup)}
                      >
                        Download
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => void handleDelete(backup)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </WindowTableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {storedError && (
        <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs">
          {storedError}
        </div>
      )}
    </section>
  );
}
