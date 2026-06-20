import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppFormPanel,
  MiniAppInput,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import type { BackupProgress } from "../../providers/db/useLocalBackupOperations";
import { useBackupRestore } from "./BackupRestoreController";
import "./BackupRestore.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatProgress(progress: BackupProgress): string {
  const labels: Record<BackupProgress["phase"], string> = {
    blobs: "OPFS blobs",
    database: "SQLite rows",
    decrypting: "Decrypting backup",
    encrypting: "Encrypting backup",
    preparing: "Preparing backup",
    restoring: "Restoring SQLite",
  };
  const count =
    progress.total > 0 ? ` ${progress.current}/${progress.total}` : "";
  const item = progress.item ? `: ${progress.item}` : "";

  return `${labels[progress.phase]}${count}${item}`;
}

function BackupSummaryDetails({
  lastSummary,
}: Pick<ReturnType<typeof useBackupRestore>, "lastSummary">) {
  if (!lastSummary) {
    return null;
  }

  return (
    <dl className="backup-restore-details">
      <dt>Tables</dt>
      <dd>{lastSummary.tableCount}</dd>
      <dt>Rows</dt>
      <dd>{lastSummary.rowCount}</dd>
      <dt>OPFS blobs</dt>
      <dd>{lastSummary.blobCount}</dd>
      <dt>Blob bytes</dt>
      <dd>{formatBytes(lastSummary.blobBytes)}</dd>
      <dt>Missing blobs</dt>
      <dd>{lastSummary.missingBlobCount}</dd>
    </dl>
  );
}

export function BackupRestore() {
  const model = useBackupRestore();
  const busy = model.busy !== null;

  return (
    <MiniAppRoot className="backup-restore">
      <input
        ref={model.restoreFileInputRef}
        aria-label="Backup Restore File"
        type="file"
        accept="application/json,.json,.tlbackup"
        hidden
        onChange={model.handleRestoreFileChange}
      />
      <main className="backup-restore-main">
        <MiniAppSection>
          <MiniAppSectionHeading>
            <h2>Local Backup</h2>
            <MiniAppStatus as="span">
              SQLite {model.databaseStatus}
            </MiniAppStatus>
          </MiniAppSectionHeading>
          {model.error && (
            <MiniAppStatus tone="error">{model.error}</MiniAppStatus>
          )}
          {model.status && <MiniAppStatus>{model.status}</MiniAppStatus>}
          {model.progress && (
            <MiniAppStatus>{formatProgress(model.progress)}</MiniAppStatus>
          )}
          {model.restoreComplete && (
            <MiniAppButton
              className="backup-restore-inline-action"
              onClick={model.handleReload}
              variant="ghost"
            >
              <ArrowsClockwiseIcon aria-hidden size={16} />
              Reload App
            </MiniAppButton>
          )}
          <BackupSummaryDetails lastSummary={model.lastSummary} />
        </MiniAppSection>

        <div className="backup-restore-actions">
          <MiniAppFormPanel
            aria-label="Export local backup"
            className="backup-restore-panel"
            variant="framed"
            onSubmit={(event) => {
              event.preventDefault();
              void model.handleExportBackup();
            }}
          >
            <MiniAppSectionHeading>
              <h2>Export</h2>
            </MiniAppSectionHeading>
            <MiniAppField>
              <span>Password</span>
              <MiniAppInput
                autoComplete="new-password"
                disabled={busy}
                type="password"
                value={model.backupPassword}
                onChange={(event) =>
                  model.setBackupPassword(event.target.value)
                }
              />
            </MiniAppField>
            <MiniAppField>
              <span>Confirm Password</span>
              <MiniAppInput
                autoComplete="new-password"
                disabled={busy}
                type="password"
                value={model.confirmBackupPassword}
                onChange={(event) =>
                  model.setConfirmBackupPassword(event.target.value)
                }
              />
            </MiniAppField>
            <MiniAppButton
              block
              className="backup-restore-action-button"
              disabled={busy}
              type="submit"
            >
              <DownloadSimpleIcon aria-hidden size={16} />
              Export Backup
            </MiniAppButton>
          </MiniAppFormPanel>

          <MiniAppFormPanel
            aria-label="Restore local backup"
            className="backup-restore-panel"
            variant="framed"
            onSubmit={(event) => {
              event.preventDefault();
              void model.handleRestoreBackup();
            }}
          >
            <MiniAppSectionHeading>
              <h2>Restore</h2>
            </MiniAppSectionHeading>
            <MiniAppButton
              block
              className="backup-restore-action-button"
              disabled={busy}
              onClick={model.handleChooseRestoreFile}
              variant="ghost"
            >
              <UploadSimpleIcon aria-hidden size={16} />
              Choose Backup File
            </MiniAppButton>
            <MiniAppStatus>
              {model.selectedRestoreFileName ?? "No backup file selected."}
            </MiniAppStatus>
            <MiniAppField>
              <span>Password</span>
              <MiniAppInput
                autoComplete="current-password"
                disabled={busy}
                type="password"
                value={model.restorePassword}
                onChange={(event) =>
                  model.setRestorePassword(event.target.value)
                }
              />
            </MiniAppField>
            <MiniAppButton
              block
              className="backup-restore-action-button"
              disabled={busy}
              type="submit"
            >
              <ArrowsClockwiseIcon aria-hidden size={16} />
              Restore Backup
            </MiniAppButton>
          </MiniAppFormPanel>
        </div>
      </main>
    </MiniAppRoot>
  );
}
