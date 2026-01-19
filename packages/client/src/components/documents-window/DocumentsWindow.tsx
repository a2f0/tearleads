import { useCallback, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { useFileUpload } from '@/hooks/useFileUpload';
import { DocumentDetail } from '@/pages/DocumentDetail';
import { Documents } from '@/pages/Documents';
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
  const [refreshToken, setRefreshToken] = useState(0);
  const { uploadFile } = useFileUpload();

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        await Promise.all(
          files.map(async (file) => {
            try {
              await uploadFile(file);
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
            }
          })
        );
        setRefreshToken((value) => value + 1);
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
      <div className="flex h-full flex-col">
        {!selectedDocumentId && (
          <DocumentsWindowMenuBar
            onUpload={handleUpload}
            onRefresh={handleRefresh}
            onClose={onClose}
          />
        )}
        <div className="flex-1 overflow-hidden">
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
              />
            </div>
          )}
        </div>
      </div>
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
