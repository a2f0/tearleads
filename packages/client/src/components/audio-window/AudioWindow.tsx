import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
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
        {!selectedTrackId && (
          <AudioWindowMenuBar
            onClose={onClose}
            view={view}
            onViewChange={setView}
          />
        )}
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
            />
          ) : (
            <AudioWindowTableView
              onSelectTrack={handleSelectTrack}
              refreshToken={refreshToken}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
