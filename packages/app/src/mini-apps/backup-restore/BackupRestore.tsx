import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useId,
  useState,
} from "react";
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

type BackupRestoreModel = ReturnType<typeof useBackupRestore>;

type BackupRestoreTabId = "backup" | "restore";

const BACKUP_RESTORE_TABS: ReadonlyArray<{
  id: BackupRestoreTabId;
  label: string;
}> = [
  { id: "backup", label: "Backup" },
  { id: "restore", label: "Restore" },
];

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
      <dd>{formatBytes(lastSummary.blobBytes)}</dd>
      <dt>Missing blobs</dt>
      <dd>{lastSummary.missingBlobCount}</dd>
    </dl>
  );
}

// Live status shared by both operations: SQLite readiness, the last error or
// status line, in-flight progress, the post-restore reload prompt, and the last
// summary. Kept above the tabs so a running export/restore stays visible no
// matter which tab is focused (the controller holds a single set of these).
function BackupRestoreStatus({ model }: { model: BackupRestoreModel }) {
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Local Backup</h2>
        <MiniAppStatus as="span">SQLite {model.databaseStatus}</MiniAppStatus>
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
function BackupRestoreTabBar({
  activeTab,
  idPrefix,
  onSelect,
}: {
  activeTab: BackupRestoreTabId;
  idPrefix: string;
  onSelect: (tab: BackupRestoreTabId) => void;
}) {
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const lastIndex = BACKUP_RESTORE_TABS.length - 1;
      const currentIndex = BACKUP_RESTORE_TABS.findIndex(
        (tab) => tab.id === activeTab,
      );
      let nextIndex: number;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = lastIndex;
          break;
        default:
          return;
      }
      const nextTab = BACKUP_RESTORE_TABS[nextIndex];
      if (!nextTab) {
        return;
      }
      event.preventDefault();
      onSelect(nextTab.id);
      document.getElementById(`${idPrefix}-${nextTab.id}-tab`)?.focus();
    },
    [activeTab, idPrefix, onSelect],
  );

  return (
    <div
      aria-label="Backup and restore sections"
      className="backup-restore-tabs"
      role="tablist"
    >
      {BACKUP_RESTORE_TABS.map((tab) => (
        <MiniAppButton
          aria-controls={`${idPrefix}-${tab.id}-panel`}
          aria-selected={activeTab === tab.id}
          className="backup-restore-tab"
          id={`${idPrefix}-${tab.id}-tab`}
          key={tab.id}
          role="tab"
          tabIndex={activeTab === tab.id ? 0 : -1}
          variant="ghost"
          onClick={() => {
            onSelect(tab.id);
          }}
          onKeyDown={handleTabKeyDown}
        >
          {tab.label}
        </MiniAppButton>
      ))}
    </div>
  );
}

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
          onChange={(event) => model.setRestorePassword(event.target.value)}
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
        <BackupRestoreTabBar
          activeTab={activeTab}
          idPrefix={idPrefix}
          onSelect={setActiveTab}
        />
        <div
          aria-labelledby={`${idPrefix}-${activeTab}-tab`}
          className="backup-restore-tab-panel"
          id={`${idPrefix}-${activeTab}-panel`}
          role="tabpanel"
        >
          {activeTab === "backup" ? (
            <BackupExportPanel busy={busy} model={model} />
          ) : (
            <BackupRestorePanel busy={busy} model={model} />
          )}
        </div>
      </main>
    </MiniAppRoot>
  );
}
