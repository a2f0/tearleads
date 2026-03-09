import {
  FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import { CameraCapture, type CameraPhotoRollItem } from './CameraCapture';
import { CameraWindowMenuBar } from './CameraWindowMenuBar';

const DEFAULT_WIDTH = 840;
const DEFAULT_HEIGHT = 620;
const MIN_WIDTH = 520;
const MIN_HEIGHT = 420;

export interface CameraWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  onPhotoAccepted?: ((dataUrl: string) => void) | undefined;
  initialPhotos?: CameraPhotoRollItem[] | undefined;
}

export function CameraWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  onPhotoAccepted,
  initialPhotos
}: CameraWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Camera"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={DEFAULT_WIDTH}
      defaultHeight={DEFAULT_HEIGHT}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
    >
      <div className="flex h-full min-h-0 flex-col">
        <CameraWindowMenuBar onClose={onClose} />
        <WindowControlBar>{null}</WindowControlBar>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <CameraCapture
            onPhotoAccepted={onPhotoAccepted}
            initialPhotos={initialPhotos}
          />
        </div>
      </div>
    </FloatingWindow>
  );
}
