import { WindowStatusBar } from '@tearleads/window-manager';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { DropZoneOverlay } from '@/components/ui/drop-zone-overlay';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';
import { useDropZone } from '@/hooks/useDropZone';
import type { FilesWindowContentRef } from './FilesWindowContent';
import { FilesWindowContent } from './FilesWindowContent';
import { FilesWindowDetail } from './FilesWindowDetail';
import type { ViewMode } from './FilesWindowMenuBar';
import { FilesWindowMenuBar } from './FilesWindowMenuBar';
import { FilesWindowTableView } from './FilesWindowTableView';

interface FilesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function FilesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: FilesWindowProps) {
  const openRequest = useWindowOpenRequest('files');
  const [showDeleted, setShowDeleted] = useState(false);
  const [showDropzone, setShowDropzone] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [listStatusText, setListStatusText] = useState('Loading files...');
  const [refreshToken, setRefreshToken] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<FilesWindowContentRef>(null);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleUploadFiles = useCallback((files: File[]) => {
    contentRef.current?.uploadFiles(files);
  }, []);

  // Main content area drop zone (accepts all file types)
  const { isDragging, dropZoneProps } = useDropZone({
    onDrop: handleUploadFiles
  });

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        handleUploadFiles(files);
      }
      e.target.value = '';
    },
    [handleUploadFiles]
  );

  const handleSelectFile = useCallback((fileId: string) => {
    setSelectedFileId(fileId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedFileId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedFileId(null);
    setRefreshToken((value) => value + 1);
  }, []);

  const statusText = selectedFileId
    ? 'Viewing file details'
    : viewMode === 'list'
      ? listStatusText
      : showDeleted
        ? 'Browsing deleted files'
        : 'Browsing files';

  useEffect(() => {
    if (!openRequest) return;
    setSelectedFileId(openRequest.fileId);
  }, [openRequest]);

  return (
    <FloatingWindow
      id={id}
      title="Files"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={800}
      defaultHeight={600}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <FilesWindowMenuBar
          showDeleted={showDeleted}
          onShowDeletedChange={setShowDeleted}
          showDropzone={showDropzone}
          onShowDropzoneChange={setShowDropzone}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onUpload={handleUpload}
          onClose={onClose}
        />
        <div className="relative flex-1 overflow-hidden" {...dropZoneProps}>
          {selectedFileId ? (
            <FilesWindowDetail
              fileId={selectedFileId}
              onBack={handleBack}
              onDeleted={handleDeleted}
            />
          ) : viewMode === 'list' ? (
            <FilesWindowContent
              ref={contentRef}
              showDeleted={showDeleted}
              showDropzone={showDropzone}
              onSelectFile={handleSelectFile}
              onStatusTextChange={setListStatusText}
              refreshToken={refreshToken}
              onUpload={handleUpload}
            />
          ) : (
            <FilesWindowTableView
              showDeleted={showDeleted}
              onUpload={handleUpload}
              onSelectFile={handleSelectFile}
              refreshToken={refreshToken}
            />
          )}
          <DropZoneOverlay isVisible={isDragging} label="files" />
        </div>
        <WindowStatusBar>{statusText}</WindowStatusBar>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="file-input"
      />
    </FloatingWindow>
  );
}
