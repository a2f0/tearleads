import { Button } from '@tearleads/ui';
import { type ChangeEvent, useCallback, useRef } from 'react';

import { RestoreBackupForm } from '../RestoreBackupForm';
import { CreateBackupSection } from './CreateBackupSection';
import { StoredBackupsSection } from './StoredBackupsSection';
import { useBackupManager } from './useBackupManager';

export function BackupManagerView() {
  const {
    password,
    confirmPassword,
    includeBlobs,
    isCreating,
    createProgress,
    createSuccess,
    createError,
    estimatedSize,
    backups,
    storageSummary,
    storedError,
    isLoadingBackups,
    selectedBackup,
    selectedBackupData,
    externalFile,
    externalFileData,
    restoreError,
    isStorageSupported,
    isRestoring,
    setPassword,
    setConfirmPassword,
    setIncludeBlobs,
    loadBackups,
    handleCreate,
    handleRestoreStored,
    handleDelete,
    handleDownload,
    handleFileSelect,
    clearRestoreSelection
  } = useBackupManager();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleSelectFile = () => {
    fileInputRef.current?.click();
  };

  const clearRestore = useCallback(() => {
    clearRestoreSelection();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [clearRestoreSelection]);

  return (
    <div className="space-y-6">
      <CreateBackupSection
        password={password}
        confirmPassword={confirmPassword}
        includeBlobs={includeBlobs}
        isCreating={isCreating}
        createProgress={createProgress}
        createSuccess={createSuccess}
        createError={createError}
        estimatedSize={estimatedSize}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onIncludeBlobsChange={setIncludeBlobs}
        onCreate={handleCreate}
      />

      {isStorageSupported && (
        <StoredBackupsSection
          backups={backups}
          isLoadingBackups={isLoadingBackups}
          storedError={storedError}
          storageSummary={storageSummary}
          loadBackups={loadBackups}
          handleRestoreStored={handleRestoreStored}
          handleDownload={handleDownload}
          handleDelete={handleDelete}
        />
      )}

      <section>
        <h3 className="mb-2 font-medium text-foreground text-sm">
          Restore from File
        </h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tbu"
          onChange={handleFileInputChange}
          className="hidden"
        />
        {!isRestoring && (
          <Button
            variant="secondary"
            onClick={handleSelectFile}
            className="w-full"
          >
            Select Backup File (.tbu)
          </Button>
        )}

        {restoreError && (
          <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs">
            {restoreError}
          </div>
        )}
      </section>

      {selectedBackup && selectedBackupData && (
        <section>
          <RestoreBackupForm
            key={selectedBackup.name}
            backupName={selectedBackup.name}
            backupData={selectedBackupData}
            onClear={clearRestore}
          />
        </section>
      )}

      {externalFile && externalFileData && (
        <section>
          <RestoreBackupForm
            key={externalFile.name}
            backupName={externalFile.name}
            backupData={externalFileData}
            onClear={clearRestore}
          />
        </section>
      )}
    </div>
  );
}
