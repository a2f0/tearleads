import { useCallback, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { VideoPage } from '@/pages/Video';
import { VideoDetail } from '@/pages/VideoDetail';
import type { ViewMode } from './VideoWindowMenuBar';
import { VideoWindowMenuBar } from './VideoWindowMenuBar';

interface VideoWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function VideoWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: VideoWindowProps) {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [autoPlay, setAutoPlay] = useState(false);

  const handleOpenVideo = useCallback(
    (videoId: string, options?: { autoPlay?: boolean | undefined }) => {
      setActiveVideoId(videoId);
      setAutoPlay(options?.autoPlay ?? false);
    },
    []
  );

  const handleBack = useCallback(() => {
    setActiveVideoId(null);
    setAutoPlay(false);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setActiveVideoId(null);
    setAutoPlay(false);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Videos"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      initialDimensions={initialDimensions}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <VideoWindowMenuBar
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onClose={onClose}
        />
        <div className="flex-1 overflow-hidden">
          <MemoryRouter initialEntries={['/videos']}>
            {activeVideoId ? (
              <div className="h-full overflow-auto p-3">
                <VideoDetail
                  videoId={activeVideoId}
                  onBack={handleBack}
                  autoPlay={autoPlay}
                />
              </div>
            ) : (
              <div className="h-full overflow-auto p-3">
                <VideoPage
                  onOpenVideo={handleOpenVideo}
                  hideBackLink
                  viewMode={viewMode}
                />
              </div>
            )}
          </MemoryRouter>
        </div>
      </div>
    </FloatingWindow>
  );
}
