import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  type BackupProgressEvent,
  getBackupsRuntime
} from '../../../runtime/backupsRuntime';
import type { BackupListItem, BackupProgress } from './utils';
import { formatBytes } from './utils';

const SUCCESS_MESSAGE_DISPLAY_DURATION = 2000;

interface BackupManagerState {
  password: string;
  confirmPassword: string;
  includeBlobs: boolean;
  isCreating: boolean;
  createProgress: BackupProgress | null;
  createError: string | null;
  createSuccess: string | null;
  estimatedSize: { blobCount: number; blobTotalSize: number } | null;
  backups: BackupListItem[];
  storageUsed: number | null;
  storedError: string | null;
  isLoadingBackups: boolean;
  selectedBackup: BackupListItem | null;
  selectedBackupData: Uint8Array | null;
  externalFile: File | null;
  externalFileData: Uint8Array | null;
  restoreError: string | null;
}

const initialState: BackupManagerState = {
  password: '',
  confirmPassword: '',
  includeBlobs: true,
  isCreating: false,
  createProgress: null,
  createError: null,
  createSuccess: null,
  estimatedSize: null,
  backups: [],
  storageUsed: null,
  storedError: null,
  isLoadingBackups: false,
  selectedBackup: null,
  selectedBackupData: null,
  externalFile: null,
  externalFileData: null,
  restoreError: null
};

type BackupManagerAction =
  | { type: 'merge'; payload: Partial<BackupManagerState> }
  | { type: 'resetRestore' };

function reducer(
  state: BackupManagerState,
  action: BackupManagerAction
): BackupManagerState {
  switch (action.type) {
    case 'merge':
      return { ...state, ...action.payload };
    case 'resetRestore':
      return {
        ...state,
        selectedBackup: null,
        selectedBackupData: null,
        externalFile: null,
        externalFileData: null,
        restoreError: null
      };
    default:
      return state;
  }
}

export interface UseBackupManagerResult {
  password: string;
  confirmPassword: string;
  includeBlobs: boolean;
  isCreating: boolean;
  createProgress: BackupProgress | null;
  createError: string | null;
  createSuccess: string | null;
  estimatedSize: { blobCount: number; blobTotalSize: number } | null;
  backups: BackupListItem[];
  storageUsed: number | null;
  storedError: string | null;
  isLoadingBackups: boolean;
  selectedBackup: BackupListItem | null;
  selectedBackupData: Uint8Array | null;
  externalFile: File | null;
  externalFileData: Uint8Array | null;
  restoreError: string | null;
  isStorageSupported: boolean;
  isRestoring: boolean;
  storageSummary: string | null;
  setPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  setIncludeBlobs: (value: boolean) => void;
  loadBackups: () => Promise<void>;
  handleCreate: () => Promise<void>;
  handleRestoreStored: (backup: BackupListItem) => Promise<void>;
  handleDelete: (backup: BackupListItem) => Promise<void>;
  handleDownload: (backup: BackupListItem) => Promise<void>;
  handleFileSelect: (file: File) => Promise<void>;
  clearRestoreSelection: () => void;
}

export function useBackupManager(): UseBackupManagerResult {
  const runtime = getBackupsRuntime();
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const isMountedRef = useRef(true);

  const mergeState = useCallback(
    (payload: Partial<BackupManagerState>) =>
      dispatch({ type: 'merge', payload }),
    []
  );

  const resetRestoreSelection = useCallback(
    () => dispatch({ type: 'resetRestore' }),
    []
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isStorageSupported = useMemo(
    () => runtime.isBackupStorageSupported(),
    [runtime]
  );

  const setPassword = useCallback(
    (value: string) => mergeState({ password: value }),
    [mergeState]
  );

  const setConfirmPassword = useCallback(
    (value: string) => mergeState({ confirmPassword: value }),
    [mergeState]
  );

  const setIncludeBlobs = useCallback(
    (value: boolean) => mergeState({ includeBlobs: value }),
    [mergeState]
  );

  const loadBackups = useCallback(async () => {
    if (!isStorageSupported) return;

    mergeState({ isLoadingBackups: true, storedError: null });
    try {
      const items = await runtime.listStoredBackups();
      const used = await runtime.getBackupStorageUsed();
      if (!isMountedRef.current) return;
      mergeState({ backups: items, storageUsed: used });
    } catch (err) {
      if (!isMountedRef.current) return;
      mergeState({
        storedError:
          err instanceof Error ? err.message : 'Failed to load backups'
      });
    } finally {
      if (isMountedRef.current) {
        mergeState({ isLoadingBackups: false });
      }
    }
  }, [isStorageSupported, mergeState, runtime]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const includeBlobs = state.includeBlobs;

  const updateEstimate = useCallback(async () => {
      try {
      const estimate = await runtime.estimateBackupSize(includeBlobs);
      if (!isMountedRef.current) return;
      mergeState({
        estimatedSize: {
          blobCount: estimate.blobCount,
          blobTotalSize: estimate.blobTotalSize
        }
      });
    } catch {
      // Ignore estimate errors
    }
  }, [includeBlobs, mergeState, runtime]);

  useEffect(() => {
    void updateEstimate();
  }, [updateEstimate]);

  const handleProgressUpdate = useCallback(
    (event: BackupProgressEvent) => {
      const phaseLabels: Record<string, string> = {
        preparing: 'Preparing',
        database: 'Backing up database',
        blobs: 'Backing up files',
        finalizing: 'Finalizing'
      };

      mergeState({
        createProgress: {
          phase: phaseLabels[event.phase] ?? event.phase,
          percent:
            event.total > 0
              ? Math.round((event.current / event.total) * 100)
              : 0,
          currentItem: event.currentItem
        }
      });
    },
    [mergeState]
  );

  const loadBackupsRef = useRef(loadBackups);
  useEffect(() => {
    loadBackupsRef.current = loadBackups;
  }, [loadBackups]);

  const handleCreate = useCallback(async () => {
    mergeState({ createError: null, createSuccess: null });
    const currentState = stateRef.current;
    const { password, confirmPassword, includeBlobs } = currentState;

    if (!password) {
      mergeState({ createError: 'Please enter a password' });
      return;
    }

    if (password !== confirmPassword) {
      mergeState({ createError: 'Passwords do not match' });
      return;
    }

    mergeState({ isCreating: true, createProgress: null });

    try {
      const result = await runtime.createBackup({
        password,
        includeBlobs,
        onProgress: handleProgressUpdate
      });

      if (result.destination === 'storage') {
        if (!isMountedRef.current) return;
        mergeState({
          createSuccess: `Backup saved as "${result.filename}".`
        });
        await loadBackupsRef.current();
      } else {
        if (!isMountedRef.current) return;
        mergeState({
          createSuccess: `Backup downloaded as "${result.filename}".`
        });
      }

      mergeState({ createProgress: { phase: 'Complete', percent: 100 } });

      setTimeout(() => {
        if (!isMountedRef.current) return;
        mergeState({
          password: '',
          confirmPassword: '',
          createProgress: null,
          createSuccess: null
        });
      }, SUCCESS_MESSAGE_DISPLAY_DURATION);
    } catch (err) {
      if (!isMountedRef.current) return;
      mergeState({
        createError:
          err instanceof Error ? err.message : 'Failed to create backup',
        createProgress: null
      });
    } finally {
      if (isMountedRef.current) {
        mergeState({ isCreating: false });
      }
    }
  }, [handleProgressUpdate, mergeState, runtime]);

  const handleRestoreStored = useCallback(
    async (backup: BackupListItem) => {
      mergeState({ storedError: null });
      try {
        const data = await runtime.readBackupFromStorage(backup.name);
        if (!isMountedRef.current) return;
        mergeState({
          selectedBackup: backup,
          selectedBackupData: data,
          externalFile: null,
          externalFileData: null
        });
      } catch (err) {
        if (!isMountedRef.current) return;
        mergeState({
          storedError:
            err instanceof Error ? err.message : 'Failed to read backup'
        });
      }
    },
    [mergeState, runtime]
  );

  const handleDelete = useCallback(
    async (backup: BackupListItem) => {
      mergeState({ storedError: null });
      try {
        await runtime.deleteBackupFromStorage(backup.name);
        const selectedBackup = stateRef.current.selectedBackup;
        if (selectedBackup?.name === backup.name) {
          mergeState({
            selectedBackup: null,
            selectedBackupData: null
          });
        }
        await loadBackupsRef.current();
      } catch (err) {
        if (!isMountedRef.current) return;
        mergeState({
          storedError:
            err instanceof Error ? err.message : 'Failed to delete backup'
        });
      }
    },
    [mergeState, runtime]
  );

  const handleDownload = useCallback(
    async (backup: BackupListItem) => {
      mergeState({ storedError: null });
      try {
        const data = await runtime.readBackupFromStorage(backup.name);
        await runtime.saveFile(data, backup.name);
      } catch (err) {
        if (!isMountedRef.current) return;
        mergeState({
          storedError:
            err instanceof Error ? err.message : 'Failed to download backup'
        });
      }
    },
    [mergeState, runtime]
  );

  const handleFileSelect = useCallback(
    async (file: File) => {
      mergeState({
        restoreError: null,
        externalFile: file,
        selectedBackup: null,
        selectedBackupData: null,
        externalFileData: null
      });
      try {
        const arrayBuffer = await file.arrayBuffer();
        if (!isMountedRef.current) return;
        mergeState({
          externalFileData: new Uint8Array(arrayBuffer)
        });
      } catch {
        if (!isMountedRef.current) return;
        mergeState({ restoreError: 'Failed to read backup file' });
      }
    },
    [mergeState]
  );

  const storageSummary = useMemo(() => {
    if (state.storageUsed === null) return null;
    return `${formatBytes(state.storageUsed)} used`;
  }, [state.storageUsed]);

  return {
    password: state.password,
    confirmPassword: state.confirmPassword,
    includeBlobs: state.includeBlobs,
    isCreating: state.isCreating,
    createProgress: state.createProgress,
    createError: state.createError,
    createSuccess: state.createSuccess,
    estimatedSize: state.estimatedSize,
    backups: state.backups,
    storageUsed: state.storageUsed,
    storedError: state.storedError,
    isLoadingBackups: state.isLoadingBackups,
    selectedBackup: state.selectedBackup,
    selectedBackupData: state.selectedBackupData,
    externalFile: state.externalFile,
    externalFileData: state.externalFileData,
    restoreError: state.restoreError,
    isStorageSupported,
    isRestoring: state.selectedBackup !== null || state.externalFile !== null,
    storageSummary,
    setPassword,
    setConfirmPassword,
    setIncludeBlobs,
    loadBackups,
    handleCreate,
    handleRestoreStored,
    handleDelete,
    handleDownload,
    handleFileSelect,
    clearRestoreSelection: resetRestoreSelection
  };
}
