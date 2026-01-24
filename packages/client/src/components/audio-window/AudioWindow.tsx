import { useCallback, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { useFileUpload } from '@/hooks/useFileUpload';
import { AudioWindowDetail } from './AudioWindowDetail';
import { AudioWindowList } from './AudioWindowList';
import type { AudioViewMode } from './AudioWindowMenuBar';
import { AudioWindowMenuBar } from './AudioWindowMenuBar';
import { AudioWindowTableView } from './AudioWindowTableView';

interface AudioWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AudioWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AudioWindowProps) {
  const [view, setView] = useState<AudioViewMode>('list');
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showDropzone, setShowDropzone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile } = useFileUpload();

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
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
    },
    [uploadFile]
  );

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

  const handleSelectTrack = useCallback((trackId: string) => {
    setSelectedTrackId(trackId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedTrackId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedTrackId(null);
    setRefreshToken((value) => value + 1);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Audio"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={450}
      defaultHeight={500}
      minWidth={350}
      minHeight={350}
    >
      <div className="flex h-full flex-col">
        <AudioWindowMenuBar
          onClose={onClose}
          onUpload={handleUpload}
          view={view}
          onViewChange={setView}
          showDropzone={showDropzone}
          onShowDropzoneChange={setShowDropzone}
        />
        <div className="flex-1 overflow-hidden">
          {selectedTrackId ? (
            <AudioWindowDetail
              audioId={selectedTrackId}
              onBack={handleBack}
              onDeleted={handleDeleted}
            />
          ) : view === 'list' ? (
            <AudioWindowList
              onSelectTrack={handleSelectTrack}
              refreshToken={refreshToken}
              showDropzone={showDropzone}
              onUploadFiles={handleUploadFiles}
            />
          ) : (
            <AudioWindowTableView
              onSelectTrack={handleSelectTrack}
              refreshToken={refreshToken}
            />
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple={false}
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="audio-file-input"
      />
    </FloatingWindow>
  );
}
