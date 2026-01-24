import { useCallback, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { isOpfsSupported, uploadIso } from '@/lib/v86/iso-storage';
import type { IsoCatalogEntry } from '@/lib/v86/types';
import { IsoDirectory } from './IsoDirectory';
import { V86Emulator } from './V86Emulator';
import { V86WindowMenuBar } from './V86WindowMenuBar';

interface V86WindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function V86Window({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: V86WindowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedIso, setSelectedIso] = useState<IsoCatalogEntry | null>(null);
  const [showDropzone, setShowDropzone] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUploadFiles = useCallback(async (files: File[]) => {
    setUploadError(null);
    if (!isOpfsSupported()) {
      setUploadError(
        'Your browser does not support the Origin Private File System (OPFS).'
      );
      return;
    }

    if (files.length === 0) return;

    let uploadedCount = 0;
    const errors: string[] = [];

    await Promise.all(
      files.map(async (file) => {
        try {
          await uploadIso(file);
          uploadedCount++;
        } catch (err) {
          console.error(`Failed to upload ${file.name}:`, err);
          errors.push(
            `"${file.name}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })
    );

    if (uploadedCount > 0) {
      setRefreshToken((value) => value + 1);
    }

    if (errors.length > 0) {
      setUploadError(errors.join('\n'));
    }
  }, []);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      await handleUploadFiles(files);
      e.target.value = '';
    },
    [handleUploadFiles]
  );

  return (
    <FloatingWindow
      id={id}
      title="v86"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={800}
      defaultHeight={600}
      minWidth={640}
      minHeight={480}
    >
      <div className="flex h-full flex-col">
        <V86WindowMenuBar
          showDropzone={showDropzone}
          onShowDropzoneChange={setShowDropzone}
          onUpload={handleUpload}
          onClose={onClose}
        />
        <div className="min-h-0 flex-1">
          {selectedIso ? (
            <V86Emulator
              iso={selectedIso}
              onBack={() => setSelectedIso(null)}
            />
          ) : (
            <div className="flex h-full flex-col">
              {uploadError && (
                <div className="mx-3 mt-3 whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
                  {uploadError}
                </div>
              )}
              <IsoDirectory
                onSelectIso={setSelectedIso}
                showDropzone={showDropzone}
                onUploadFiles={handleUploadFiles}
                refreshToken={refreshToken}
              />
            </div>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".iso,application/x-iso9660-image"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="v86-iso-input"
      />
    </FloatingWindow>
  );
}
