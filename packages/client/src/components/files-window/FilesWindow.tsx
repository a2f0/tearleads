import { useCallback, useRef, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
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
  const [showDeleted, setShowDeleted] = useState(false);
  const [showDropzone, setShowDropzone] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<FilesWindowContentRef>(null);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        contentRef.current?.uploadFiles(files);
      }
      e.target.value = '';
    },
    []
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
      <MemoryRouter initialEntries={['/files']}>
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
          <div className="flex-1 overflow-hidden">
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
                refreshToken={refreshToken}
              />
            ) : (
              <FilesWindowTableView
                showDeleted={showDeleted}
                onUpload={handleUpload}
                onSelectFile={handleSelectFile}
                refreshToken={refreshToken}
              />
            )}
          </div>
        </div>
      </MemoryRouter>
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
