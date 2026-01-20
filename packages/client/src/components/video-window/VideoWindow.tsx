import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { VideoPage } from '@/pages/Video';
import { VideoDetail } from '@/pages/VideoDetail';

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
      <MemoryRouter initialEntries={['/videos']}>
        {activeVideoId ? (
          <div className="h-full overflow-auto p-3">
            <VideoDetail
              videoId={activeVideoId}
              onBack={() => setActiveVideoId(null)}
            />
          </div>
        ) : (
          <div className="h-full overflow-hidden p-3">
            <VideoPage
              onOpenVideo={(videoId) => setActiveVideoId(videoId)}
              hideBackLink
            />
          </div>
        )}
      </MemoryRouter>
    </FloatingWindow>
  );
}
