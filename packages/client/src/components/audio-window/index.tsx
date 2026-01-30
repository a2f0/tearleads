import { AudioWindow as AudioWindowBase } from '@rapid/audio';
import type { WindowDimensions } from '@rapid/window-manager';
import { ClientAudioProvider } from '@/contexts/ClientAudioProvider';

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
 * required by the @rapid/audio package.
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
      />
    </ClientAudioProvider>
  );
}
