import { useState } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { VideoPage } from '@/pages/Video';
import { VideoDetail } from '@/pages/VideoDetail';
import { VideoWindowMenuBar, type ViewMode } from './VideoWindowMenuBar';

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
  const [viewMode, setViewMode] = useState<ViewMode>('list');

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
          onViewModeChange={setViewMode}
        />
        <div className="flex-1 overflow-hidden">
          <MemoryRouter initialEntries={['/videos']}>
            <Routes>
              <Route path="/" element={<Navigate to="/videos" replace />} />
              <Route
                path="/videos"
                element={
                  <div className="h-full overflow-hidden p-3">
                    <VideoPage viewMode={viewMode} showBackLink={false} />
                  </div>
                }
              />
              <Route
                path="/videos/:id"
                element={
                  <div className="h-full overflow-auto p-3">
                    <VideoDetail />
                  </div>
                }
              />
            </Routes>
          </MemoryRouter>
        </div>
      </div>
    </FloatingWindow>
  );
}
