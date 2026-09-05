import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { useId, useState } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppFormPanel,
  MiniAppInput,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../components/mini-app/MiniAppLayout";
import type { BackupProgress } from "../../providers/db/useLocalBackupOperations";
import { formatByteSize } from "../../utils/formatByteSize";
import { useBackupRestore } from "./BackupRestoreController";
import "./BackupRestore.css";

type BackupRestoreModel = ReturnType<typeof useBackupRestore>;

type BackupRestoreTabId = "backup" | "restore";

const BACKUP_RESTORE_TABS: ReadonlyArray<
  MiniAppTabDescriptor<BackupRestoreTabId>
> = [
  { id: "backup", label: "Backup" },
  { id: "restore", label: "Restore" },
];

const BACKUP_RESTORE_TABS_LABEL = "Backup and restore sections";

function formatProgress(progress: BackupProgress): string {
  const labels: Record<BackupProgress["phase"], string> = {
    blobs: "OPFS blobs",
    database: "SQLite rows",
    decrypting: "Decrypting backup",
    encrypting: "Encrypting backup",
    preparing: "Preparing data",
    restoring: "Restoring SQLite",
  };
  const count =
    progress.total > 0 ? ` ${progress.current}/${progress.total}` : "";
  const item = progress.item ? `: ${progress.item}` : "";

  return `${labels[progress.phase]}${count}${item}`;
}

function BackupSummaryDetails({
  lastSummary,
}: Pick<BackupRestoreModel, "lastSummary">) {
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
      <dd>{formatByteSize(lastSummary.blobBytes)}</dd>
      <dt>Missing blobs</dt>
      <dd>{lastSummary.missingBlobCount}</dd>
    </dl>
  );
}

// Live status shared by both operations: the last error or status line,
// in-flight progress, the post-restore reload prompt, and the last summary.
// Kept above the tabs so a running export/restore stays visible no matter which
// tab is focused (the controller holds a single set of these).
function BackupRestoreStatus({ model }: { model: BackupRestoreModel }) {
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Local Backup</h2>
      </MiniAppSectionHeading>
      {model.error && <MiniAppStatus tone="error">{model.error}</MiniAppStatus>}
      {model.status && <MiniAppStatus>{model.status}</MiniAppStatus>}
      {model.progress && (
        <MiniAppStatus>{formatProgress(model.progress)}</MiniAppStatus>
      )}
      {model.restoreComplete && (
        <MiniAppButton
          className="backup-restore-inline-action"
          onClick={model.handleReload}
          variant="ghost"
          withIcon
        >
          <ArrowsClockwiseIcon aria-hidden size={16} />
          Reload App
        </MiniAppButton>
      )}
      <BackupSummaryDetails lastSummary={model.lastSummary} />
    </MiniAppSection>
  );
}

// Roving tabindex per the WAI-ARIA tab pattern (mirrors SystemMonitorTabs): only
// the active tab is in the tab order; arrow/Home/End move focus and selection.
function BackupExportPanel({
  busy,
  model,
}: {
  busy: boolean;
  model: BackupRestoreModel;
}) {
  return (
    <MiniAppFormPanel
      aria-label="Export local backup"
      className="backup-restore-panel"
      variant="framed"
      onSubmit={(event) => {
        event.preventDefault();
        void model.handleExportBackup();
      }}
    >
      <label className="backup-restore-password-option">
        <input
          checked={model.backupWithoutPassword}
          disabled={busy}
          type="checkbox"
          onChange={(event) =>
            model.setBackupWithoutPassword(event.target.checked)
          }
        />
        <span>Back up without a password</span>
      </label>
      {model.backupWithoutPassword ? (
        <p className="backup-restore-password-notice">
          Anyone with this unencrypted backup can read or modify its contents.
        </p>
      ) : (
        <>
          <MiniAppField>
            <span>Password</span>
            <MiniAppInput
              autoComplete="new-password"
              disabled={busy}
              type="password"
              value={model.backupPassword}
              onChange={(event) => model.setBackupPassword(event.target.value)}
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
        </>
      )}
      <MiniAppButton
        block
        className="backup-restore-action-button"
        disabled={busy}
        type="submit"
        withIcon
      >
        <DownloadSimpleIcon aria-hidden size={16} />
        Export Backup
      </MiniAppButton>
    </MiniAppFormPanel>
  );
}

function BackupRestorePanel({
  busy,
  model,
}: {
  busy: boolean;
  model: BackupRestoreModel;
}) {
  return (
    <MiniAppFormPanel
      aria-label="Restore local backup"
      className="backup-restore-panel"
      variant="framed"
      onSubmit={(event) => {
        event.preventDefault();
        void model.handleRestoreBackup();
      }}
    >
      <MiniAppButton
        block
        className="backup-restore-action-button"
        disabled={busy}
        onClick={model.handleChooseRestoreFile}
        variant="ghost"
        withIcon
      >
        <UploadSimpleIcon aria-hidden size={16} />
        Choose Backup File
      </MiniAppButton>
      <MiniAppStatus>
        {model.selectedRestoreFileName ?? "No backup file selected."}
      </MiniAppStatus>
      {model.restoreRequiresPassword && (
        <MiniAppField>
          <span>Password</span>
          <MiniAppInput
            autoComplete="current-password"
            disabled={busy}
            type="password"
            value={model.restorePassword}
            onChange={(event) => model.setRestorePassword(event.target.value)}
          />
        </MiniAppField>
      )}
      <MiniAppButton
        block
        className="backup-restore-action-button"
        disabled={busy}
        type="submit"
        withIcon
      >
        <ArrowsClockwiseIcon aria-hidden size={16} />
        Restore Backup
      </MiniAppButton>
    </MiniAppFormPanel>
  );
}

export function BackupRestore() {
  const model = useBackupRestore();
  const busy = model.busy !== null;
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<BackupRestoreTabId>("backup");

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
        <BackupRestoreStatus model={model} />
        <MiniAppTabList
          activeTab={activeTab}
          idPrefix={idPrefix}
          label={BACKUP_RESTORE_TABS_LABEL}
          onSelect={setActiveTab}
          tabs={BACKUP_RESTORE_TABS}
        />
        <MiniAppTabPanel activeTab={activeTab} idPrefix={idPrefix}>
          {activeTab === "backup" ? (
            <BackupExportPanel busy={busy} model={model} />
          ) : (
            <BackupRestorePanel busy={busy} model={model} />
          )}
        </MiniAppTabPanel>
      </main>
    </MiniAppRoot>
  );
}
