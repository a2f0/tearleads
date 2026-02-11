import { AudioWindow as AudioWindowBase } from '@tearleads/audio';
import type { WindowDimensions } from '@tearleads/window-manager';
import { ClientAudioProvider } from '@/contexts/ClientAudioProvider';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';

interface AudioWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

/**
 * AudioWindow wrapped with ClientAudioProvider.
 * This provides all the dependencies (database, UI components, translations)
 * required by the @tearleads/audio package.
 */
export function AudioWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AudioWindowProps) {
  const openRequest = useWindowOpenRequest('audio');

  return (
    <ClientAudioProvider>
      <AudioWindowBase
        id={id}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onFocus={onFocus}
        zIndex={zIndex}
        initialDimensions={initialDimensions}
        openAudioId={openRequest?.audioId}
        openPlaylistId={openRequest?.playlistId}
        openRequestId={openRequest?.requestId}
      />
    </ClientAudioProvider>
  );
}
