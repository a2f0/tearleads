import { useCallback, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { RestoreBackupForm } from './RestoreBackupForm';

export function RestoreBackupTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupData, setBackupData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    setError(null);
    setBackupFile(file);

    try {
      const arrayBuffer = await file.arrayBuffer();
      setBackupData(new Uint8Array(arrayBuffer));
    } catch {
      setError('Failed to read backup file');
    }
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleSelectFile = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 font-medium text-sm text-zinc-300">
          Restore from Backup
        </h3>
        <p className="text-xs text-zinc-500">
          Restore a backup to a new instance. Your current data will not be
          affected.
        </p>
      </div>

      {/* File selection */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".rbu"
          onChange={handleFileInputChange}
          className="hidden"
        />
        <Button
          variant="secondary"
          onClick={handleSelectFile}
          className="w-full"
        >
          {backupFile ? backupFile.name : 'Select Backup File (.rbu)'}
        </Button>
      </div>

      {backupFile && backupData && (
        <RestoreBackupForm
          key={backupFile.name}
          backupName={backupFile.name}
          backupData={backupData}
          onClear={() => {
            setBackupFile(null);
            setBackupData(null);
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
          }}
        />
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-red-400 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
