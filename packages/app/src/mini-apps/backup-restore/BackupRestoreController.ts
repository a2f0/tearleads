import {
  type ChangeEvent,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import {
  type BackupProgress,
  type BackupSummary,
  useLocalBackupOperations,
} from "../../providers/db/useLocalBackupOperations";
import { useLog } from "../../providers/logging/LogProvider";

type BackupRestoreBusyState = "export" | "restore" | null;
type ExportLocalBackup = ReturnType<
  typeof useLocalBackupOperations
>["exportLocalBackup"];
type RestoreLocalBackup = ReturnType<
  typeof useLocalBackupOperations
>["restoreLocalBackup"];

interface BackupRestoreOperationState {
  readonly resetOperationState: () => void;
  readonly restoreFileInputRef: RefObject<HTMLInputElement | null>;
  readonly selectedRestoreFileText: string | null;
  readonly setBackupPassword: (value: string) => void;
  readonly setBusy: (value: BackupRestoreBusyState) => void;
  readonly setConfirmBackupPassword: (value: string) => void;
  readonly setError: (value: string | null) => void;
  readonly setLastSummary: (value: BackupSummary | null) => void;
  readonly setProgress: (value: BackupProgress | null) => void;
  readonly setRestoreComplete: (value: boolean) => void;
  readonly setRestorePassword: (value: string) => void;
  readonly setSelectedRestoreFileName: (value: string | null) => void;
  readonly setSelectedRestoreFileText: (value: string | null) => void;
  readonly setStatus: (value: string | null) => void;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Operation failed.";
}

function downloadBackupFile(input: {
  readonly fileName: string;
  readonly text: string;
}): void {
  const blob = new Blob([input.text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = input.fileName;
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function formatSummary(summary: BackupSummary): string {
  const missingBlobText =
    summary.missingBlobCount > 0
      ? `, ${summary.missingBlobCount} missing blobs`
      : "";

  return `${summary.rowCount} rows, ${summary.blobCount} blobs${missingBlobText}`;
}

function useExportBackupAction(input: {
  readonly backupPassword: string;
  readonly confirmBackupPassword: string;
  readonly exportLocalBackup: ExportLocalBackup;
  readonly log: (message: string) => void;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly state: BackupRestoreOperationState;
}) {
  return useCallback(async () => {
    input.state.resetOperationState();
    if (!input.backupPassword) {
      input.state.setError("Enter a backup password.");
      return;
    }
    if (input.backupPassword !== input.confirmBackupPassword) {
      input.state.setError("Backup passwords do not match.");
      return;
    }

    input.state.setBusy("export");
    try {
      const result = await input.exportLocalBackup({
        onProgress: input.state.setProgress,
        password: input.backupPassword,
      });
      downloadBackupFile({
        fileName: result.fileName,
        text: result.text,
      });
      input.state.setBackupPassword("");
      input.state.setConfirmBackupPassword("");
      input.state.setLastSummary(result.summary);
      input.state.setStatus(
        `Backup exported: ${formatSummary(result.summary)}.`,
      );
      input.log("Local backup exported");
    } catch (operationError: unknown) {
      input.logError("Failed to export local backup", operationError);
      input.state.setError(readErrorMessage(operationError));
    } finally {
      input.state.setBusy(null);
      input.state.setProgress(null);
    }
  }, [input]);
}

function useRestoreBackupAction(input: {
  readonly log: (message: string) => void;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly restorePassword: string;
  readonly restoreLocalBackup: RestoreLocalBackup;
  readonly state: BackupRestoreOperationState;
}) {
  return useCallback(async () => {
    input.state.resetOperationState();
    if (!input.state.selectedRestoreFileText) {
      input.state.setError("Choose a backup file.");
      return;
    }
    if (!input.restorePassword) {
      input.state.setError("Enter the restore password.");
      return;
    }

    input.state.setBusy("restore");
    try {
      const summary = await input.restoreLocalBackup({
        onProgress: input.state.setProgress,
        password: input.restorePassword,
        text: input.state.selectedRestoreFileText,
      });
      input.state.setLastSummary(summary);
      input.state.setRestorePassword("");
      input.state.setSelectedRestoreFileName(null);
      input.state.setSelectedRestoreFileText(null);
      input.state.setRestoreComplete(true);
      input.state.setStatus(`Backup restored: ${formatSummary(summary)}.`);
      input.log("Local backup restored");
    } catch (operationError: unknown) {
      input.logError("Failed to restore local backup", operationError);
      input.state.setError(readErrorMessage(operationError));
    } finally {
      input.state.setBusy(null);
      input.state.setProgress(null);
      if (input.state.restoreFileInputRef.current) {
        input.state.restoreFileInputRef.current.value = "";
      }
    }
  }, [input]);
}

function useRestoreFileSelection(input: {
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly resetOperationState: () => void;
  readonly setError: (value: string | null) => void;
  readonly setSelectedRestoreFileName: (value: string | null) => void;
  readonly setSelectedRestoreFileText: (value: string | null) => void;
}) {
  return useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      input.resetOperationState();
      const file = event.currentTarget.files?.[0];
      if (!file) {
        return;
      }

      input.setSelectedRestoreFileName(file.name);
      void file
        .text()
        .then(input.setSelectedRestoreFileText)
        .catch((fileError: unknown) => {
          input.logError("Failed to read local backup file", fileError);
          input.setSelectedRestoreFileName(null);
          input.setSelectedRestoreFileText(null);
          input.setError(readErrorMessage(fileError));
        });
    },
    [input],
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
  const operationState = useMemo<BackupRestoreOperationState>(
    () => ({
      resetOperationState,
      restoreFileInputRef,
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
    }),
    [resetOperationState, selectedRestoreFileText],
  );

  return {
    backupPassword,
    busy,
    confirmBackupPassword,
    error,
    lastSummary,
    operationState,
    progress,
    resetOperationState,
    restoreComplete,
    restoreFileInputRef,
    restorePassword,
    selectedRestoreFileName,
    setBackupPassword,
    setConfirmBackupPassword,
    setError,
    setRestorePassword,
    setSelectedRestoreFileName,
    setSelectedRestoreFileText,
    status,
  };
}

export function useBackupRestore() {
  const database = useDatabase();
  const { log, logError } = useLog();
  const { exportLocalBackup, restoreLocalBackup } = useLocalBackupOperations();
  const state = useBackupRestoreState();
  const handleExportBackup = useExportBackupAction({
    backupPassword: state.backupPassword,
    confirmBackupPassword: state.confirmBackupPassword,
    exportLocalBackup,
    log,
    logError,
    state: state.operationState,
  });
  const handleRestoreBackup = useRestoreBackupAction({
    log,
    logError,
    restorePassword: state.restorePassword,
    restoreLocalBackup,
    state: state.operationState,
  });
  const handleRestoreFileChange = useRestoreFileSelection({
    logError,
    resetOperationState: state.resetOperationState,
    setError: state.setError,
    setSelectedRestoreFileName: state.setSelectedRestoreFileName,
    setSelectedRestoreFileText: state.setSelectedRestoreFileText,
  });

  const handleChooseRestoreFile = useCallback(() => {
    state.restoreFileInputRef.current?.click();
  }, [state.restoreFileInputRef]);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  return {
    backupPassword: state.backupPassword,
    busy: state.busy,
    confirmBackupPassword: state.confirmBackupPassword,
    databaseStatus: database.status,
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
