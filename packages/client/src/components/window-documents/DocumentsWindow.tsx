import { useMultiFileUpload } from '@tearleads/audio';
import {
  DesktopFloatingWindow as FloatingWindow,
  useWindowRefresh,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions,
  WindowStatusBar
} from '@tearleads/window-manager';
import { ArrowLeft, Loader2, RefreshCw, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DropZoneOverlay } from '@/components/ui/drop-zone-overlay';
import { UploadProgress } from '@/components/ui/UploadProgress';
import {
  useWindowManagerActions,
  useWindowOpenRequest
} from '@/contexts/WindowManagerContext';
import { useDropZone } from '@/hooks/dnd';
import { useFileUpload } from '@/hooks/vfs';
import { DocumentDetail } from '@/pages/DocumentDetail';
import { Documents } from '@/pages/Documents';
import type { ViewMode } from './DocumentsWindowMenuBar';
import { DocumentsWindowMenuBar } from './DocumentsWindowMenuBar';

interface DocumentsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function DocumentsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: DocumentsWindowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { openWindow } = useWindowManagerActions();
  const openRequest = useWindowOpenRequest('documents');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showDeleted, setShowDeleted] = useState(false);
  const { refreshToken, triggerRefresh } = useWindowRefresh();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showDropzone, setShowDropzone] = useState(false);
  const { uploadFile } = useFileUpload();
  const { uploadMany, uploading, uploadProgress } = useMultiFileUpload({
    uploadFile
  });

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      setUploadError(null);
      const { results, errors } = await uploadMany(files);
      for (const error of errors) {
        console.error(`Failed to upload ${error.fileName}:`, error.message);
      }

      if (results.length > 0) {
        triggerRefresh();
      }
      if (errors.length > 0) {
        const errorMessages = errors.map(
          (error) => `"${error.fileName}": ${error.message}`
        );
        setUploadError(errorMessages.join('\n'));
      }
    },
    [triggerRefresh, uploadMany]
  );

  // Main content area drop zone
  const { isDragging, dropZoneProps } = useDropZone({
    accept: 'application/pdf,text/*',
    onDrop: handleUploadFiles,
    disabled: uploading
  });

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        void handleUploadFiles(files);
      }
      e.target.value = '';
    },
    [handleUploadFiles]
  );

  const handleBack = useCallback(() => {
    setSelectedDocumentId(null);
  }, []);

  useEffect(() => {
    if (!openRequest) return;
    setSelectedDocumentId(openRequest.documentId);
  }, [openRequest]);

  const handleOpenAIChat = useCallback(() => {
    openWindow('ai');
  }, [openWindow]);

  const statusText = uploading
    ? 'Uploading documents...'
    : selectedDocumentId
      ? 'Viewing document'
      : showDeleted
        ? 'Browsing deleted documents'
        : 'Browsing documents';

  return (
    <FloatingWindow
      id={id}
      title="Documents"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
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
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showDeleted={showDeleted}
            onShowDeletedChange={setShowDeleted}
            showDropzone={showDropzone}
            onShowDropzoneChange={setShowDropzone}
            onUpload={handleUpload}
            onRefresh={handleRefresh}
            onClose={onClose}
          />
        )}
        <WindowControlBar>
          <WindowControlGroup>
            {selectedDocumentId ? (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={handleBack}
                data-testid="documents-window-control-back"
              >
                Back
              </WindowControlButton>
            ) : (
              <>
                <WindowControlButton
                  icon={<Upload className="h-3 w-3" />}
                  onClick={handleUpload}
                  disabled={uploading}
                  data-testid="documents-window-control-upload"
                >
                  Upload
                </WindowControlButton>
                <WindowControlButton
                  icon={<RefreshCw className="h-3 w-3" />}
                  onClick={handleRefresh}
                  disabled={uploading}
                  data-testid="documents-window-control-refresh"
                >
                  Refresh
                </WindowControlButton>
              </>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        <div className="relative flex-1 overflow-hidden" {...dropZoneProps}>
          {uploadError && (
            <div className="mx-3 mt-3 whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
              {uploadError}
            </div>
          )}
          {uploading ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-medium">Uploading...</p>
              </div>
              <UploadProgress progress={uploadProgress} />
            </div>
          ) : selectedDocumentId ? (
            <div className="h-full overflow-auto p-3">
              <DocumentDetail
                documentId={selectedDocumentId}
                onBack={handleBack}
              />
            </div>
          ) : (
            <div className="h-full overflow-auto p-2">
              <Documents
                showBackLink={false}
                onSelectDocument={setSelectedDocumentId}
                refreshToken={refreshToken}
                viewMode={viewMode}
                showDeleted={showDeleted}
                showDropzone={showDropzone}
                onUpload={handleUpload}
                onOpenAIChat={handleOpenAIChat}
              />
            </div>
          )}
          <DropZoneOverlay isVisible={isDragging} label="documents" />
        </div>
        <WindowStatusBar>{statusText}</WindowStatusBar>
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
