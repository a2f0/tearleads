import { useCallback, useRef, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { useFileUpload } from '@/hooks/useFileUpload';
import { DocumentDetail } from '@/pages/DocumentDetail';
import { Documents } from '@/pages/Documents';
import type { ViewMode } from './DocumentsWindowMenuBar';
import { DocumentsWindowMenuBar } from './DocumentsWindowMenuBar';

interface DocumentsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function DocumentsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: DocumentsWindowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [refreshToken, setRefreshToken] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { uploadFile } = useFileUpload();

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setUploadError(null);
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        let uploadedCount = 0;
        const errors: string[] = [];
        await Promise.all(
          files.map(async (file) => {
            try {
              await uploadFile(file);
              uploadedCount++;
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
              errors.push(
                `"${file.name}": ${
                  err instanceof Error ? err.message : String(err)
                }`
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
      }
      e.target.value = '';
    },
    [uploadFile]
  );

  const handleBack = useCallback(() => {
    setSelectedDocumentId(null);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Documents"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={400}
      minHeight={350}
    >
      <MemoryRouter initialEntries={['/documents']}>
        <div className="flex h-full flex-col">
          {!selectedDocumentId && (
            <DocumentsWindowMenuBar
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onUpload={handleUpload}
              onRefresh={handleRefresh}
              onClose={onClose}
            />
          )}
          <div className="flex-1 overflow-hidden">
            {uploadError && (
              <div className="mx-3 mt-3 whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
                {uploadError}
              </div>
            )}
            {selectedDocumentId ? (
              <div className="h-full overflow-auto p-3">
                <DocumentDetail
                  documentId={selectedDocumentId}
                  onBack={handleBack}
                />
              </div>
            ) : (
              <div className="h-full p-2">
                <Documents
                  showBackLink={false}
                  onSelectDocument={setSelectedDocumentId}
                  refreshToken={refreshToken}
                  viewMode={viewMode}
                />
              </div>
            )}
          </div>
        </div>
      </MemoryRouter>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,text/*"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="documents-file-input"
      />
    </FloatingWindow>
  );
}
