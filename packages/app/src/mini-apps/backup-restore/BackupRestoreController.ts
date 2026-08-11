import type { FileSaver } from "@tearleads/client-sdk";
import { type ChangeEvent, useCallback, useRef, useState } from "react";
import { clearRestoredLocalCaches } from "../../providers/db/clearRestoredLocalCaches";
import {
  type BackupProgress,
  type BackupSummary,
  useLocalBackupOperations,
} from "../../providers/db/useLocalBackupOperations";
import { useFileSaver } from "../../providers/file-saver/FileSaverProvider";
import { useLog } from "../../providers/logging/LogProvider";
import { downloadTextAsFile } from "../../utils/downloadFile";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";

type BackupRestoreBusyState = "export" | "restore" | null;
type ExportLocalBackup = ReturnType<
  typeof useLocalBackupOperations
>["exportLocalBackup"];
type RestoreLocalBackup = ReturnType<
  typeof useLocalBackupOperations
>["restoreLocalBackup"];
type BackupRestoreState = ReturnType<typeof useBackupRestoreState>;

function formatSummary(summary: BackupSummary): string {
  const missingBlobText =
    summary.missingBlobCount > 0
      ? `, ${summary.missingBlobCount} missing blobs`
      : "";

  return `${summary.rowCount} rows, ${summary.blobCount} blobs${missingBlobText}`;
}

function useExportBackupAction({
  backupPassword,
  confirmBackupPassword,
  exportLocalBackup,
  fileSaver,
  log,
  logError,
  state,
}: {
  readonly backupPassword: string;
  readonly confirmBackupPassword: string;
  readonly exportLocalBackup: ExportLocalBackup;
  readonly fileSaver: FileSaver;
  readonly log: (message: string) => void;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly state: BackupRestoreState;
}) {
  const {
    resetOperationState,
    setBackupPassword,
    setBusy,
    setConfirmBackupPassword,
    setError,
    setLastSummary,
    setProgress,
    setStatus,
  } = state;

  return useCallback(async () => {
    resetOperationState();
    if (!backupPassword) {
      setError("Enter a backup password.");
      return;
    }
    if (backupPassword !== confirmBackupPassword) {
      setError("Backup passwords do not match.");
      return;
    }

    setBusy("export");
    try {
      const result = await exportLocalBackup({
        onProgress: setProgress,
        password: backupPassword,
      });
      await downloadTextAsFile(fileSaver, {
        fileName: result.fileName,
        mimeType: "application/json",
        text: result.text,
      });
      setBackupPassword("");
      setConfirmBackupPassword("");
      setLastSummary(result.summary);
      setStatus(`Backup exported: ${formatSummary(result.summary)}.`);
      log("Local backup exported");
    } catch (operationError: unknown) {
      logError("Failed to export local backup", operationError);
      setError(unknownErrorMessage(operationError));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [
    backupPassword,
    confirmBackupPassword,
    exportLocalBackup,
    fileSaver,
    log,
    logError,
    resetOperationState,
    setBackupPassword,
    setBusy,
    setConfirmBackupPassword,
    setError,
    setLastSummary,
    setProgress,
    setStatus,
  ]);
}

function useRestoreBackupAction({
  log,
  logError,
  restorePassword,
  restoreLocalBackup,
  state,
}: {
  readonly log: (message: string) => void;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly restorePassword: string;
  readonly restoreLocalBackup: RestoreLocalBackup;
  readonly state: BackupRestoreState;
}) {
  const {
    resetOperationState,
    restoreFileInputRef,
    selectedRestoreFileText,
    setBusy,
    setError,
    setLastSummary,
    setProgress,
    setRestoreComplete,
    setRestorePassword,
    setSelectedRestoreFileName,
    setSelectedRestoreFileText,
    setStatus,
  } = state;

  return useCallback(async () => {
    resetOperationState();
    if (!selectedRestoreFileText) {
      setError("Choose a backup file.");
      return;
    }
    if (!restorePassword) {
      setError("Enter the restore password.");
      return;
    }

    setBusy("restore");
    try {
      const summary = await restoreLocalBackup({
        onProgress: setProgress,
        password: restorePassword,
        text: selectedRestoreFileText,
      });
      setLastSummary(summary);
      setRestorePassword("");
      setSelectedRestoreFileName(null);
      setSelectedRestoreFileText(null);
      setRestoreComplete(true);
      setStatus(`Backup restored: ${formatSummary(summary)}.`);
      log("Local backup restored");
    } catch (operationError: unknown) {
      logError("Failed to restore local backup", operationError);
      setError(unknownErrorMessage(operationError));
    } finally {
      setBusy(null);
      setProgress(null);
      if (restoreFileInputRef.current) {
        restoreFileInputRef.current.value = "";
      }
    }
  }, [
    log,
    logError,
    resetOperationState,
    restoreFileInputRef,
    restoreLocalBackup,
    restorePassword,
    selectedRestoreFileText,
    setBusy,
    setError,
    setLastSummary,
    setProgress,
    setRestoreComplete,
    setRestorePassword,
    setSelectedRestoreFileName,
    setSelectedRestoreFileText,
    setStatus,
  ]);
}

function useRestoreFileSelection({
  logError,
  state,
}: {
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly state: BackupRestoreState;
}) {
  const {
    resetOperationState,
    setError,
    setSelectedRestoreFileName,
    setSelectedRestoreFileText,
  } = state;
  // Token of the most recent selection, so a slow file.text() from a
  // superseded selection can't clobber the text of the file currently shown.
  const selectionTokenRef = useRef(0);

  return useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      resetOperationState();
      selectionTokenRef.current += 1;
      const selectionToken = selectionTokenRef.current;
      const file = event.currentTarget.files?.[0];
      if (!file) {
        setSelectedRestoreFileName(null);
        setSelectedRestoreFileText(null);
        return;
      }

      setSelectedRestoreFileName(file.name);
      void file
        .text()
        .then((text) => {
          if (selectionTokenRef.current === selectionToken) {
            setSelectedRestoreFileText(text);
          }
        })
        .catch((fileError: unknown) => {
          if (selectionTokenRef.current !== selectionToken) {
            return;
          }
          logError("Failed to read local backup file", fileError);
          setSelectedRestoreFileName(null);
          setSelectedRestoreFileText(null);
          setError(unknownErrorMessage(fileError));
        });
    },
    [
      logError,
      resetOperationState,
      setError,
      setSelectedRestoreFileName,
      setSelectedRestoreFileText,
    ],
  );
}

function useBackupRestoreState() {
  const restoreFileInputRef = useRef<HTMLInputElement>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [confirmBackupPassword, setConfirmBackupPassword] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [selectedRestoreFileName, setSelectedRestoreFileName] = useState<
    string | null
  >(null);
  const [selectedRestoreFileText, setSelectedRestoreFileText] = useState<
    string | null
  >(null);
  const [busy, setBusy] = useState<BackupRestoreBusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [lastSummary, setLastSummary] = useState<BackupSummary | null>(null);
  const [restoreComplete, setRestoreComplete] = useState(false);

  const resetOperationState = useCallback(() => {
    setError(null);
    setStatus(null);
    setProgress(null);
    setRestoreComplete(false);
  }, []);

  return {
    backupPassword,
    busy,
    confirmBackupPassword,
    error,
    lastSummary,
    progress,
    resetOperationState,
    restoreComplete,
    restoreFileInputRef,
    restorePassword,
    selectedRestoreFileName,
    selectedRestoreFileText,
    setBackupPassword,
    setBusy,
    setConfirmBackupPassword,
    setError,
    setLastSummary,
    setProgress,
    setRestoreComplete,
    setRestorePassword,
    setSelectedRestoreFileName,
    setSelectedRestoreFileText,
    setStatus,
    status,
  };
}

export function useBackupRestore() {
  const fileSaver = useFileSaver();
  const { log, logError } = useLog();
  const { exportLocalBackup, restoreLocalBackup } = useLocalBackupOperations();
  const state = useBackupRestoreState();
  const handleExportBackup = useExportBackupAction({
    backupPassword: state.backupPassword,
    confirmBackupPassword: state.confirmBackupPassword,
    exportLocalBackup,
    fileSaver,
    log,
    logError,
    state,
  });
  const handleRestoreBackup = useRestoreBackupAction({
    log,
    logError,
    restorePassword: state.restorePassword,
    restoreLocalBackup,
    state,
  });
  const handleRestoreFileChange = useRestoreFileSelection({ logError, state });

  const handleChooseRestoreFile = useCallback(() => {
    state.restoreFileInputRef.current?.click();
  }, [state.restoreFileInputRef]);

  // Shown only after a successful restore (BackupRestore.tsx gates it on
  // restoreComplete). Clear the stale pre-restore caches before reloading so the
  // reopened app re-derives the root container + read models from the restored
  // database instead of re-bootstrapping an empty root.
  const handleReload = useCallback(() => {
    clearRestoredLocalCaches();
    window.location.reload();
  }, []);

  return {
    backupPassword: state.backupPassword,
    busy: state.busy,
    confirmBackupPassword: state.confirmBackupPassword,
    error: state.error,
    handleChooseRestoreFile,
    handleExportBackup,
    handleReload,
    handleRestoreBackup,
    handleRestoreFileChange,
    lastSummary: state.lastSummary,
    progress: state.progress,
    restoreComplete: state.restoreComplete,
    restoreFileInputRef: state.restoreFileInputRef,
    restorePassword: state.restorePassword,
    selectedRestoreFileName: state.selectedRestoreFileName,
    setBackupPassword: state.setBackupPassword,
    setConfirmBackupPassword: state.setConfirmBackupPassword,
    setRestorePassword: state.setRestorePassword,
    status: state.status,
  };
}
