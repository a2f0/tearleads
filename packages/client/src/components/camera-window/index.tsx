import { CameraWindow as CameraWindowBase } from '@tearleads/camera';
import type { WindowDimensions } from '@tearleads/window-manager';
import { useCallback } from 'react';
import { usePhotoAlbums } from '@/components/photos-window/usePhotoAlbums';
import { useFileUpload } from '@/hooks/vfs';

interface CameraWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64Data] = dataUrl.split(',');
  const mimeMatch = header?.match(/data:([^;]+)/);
  const mimeType = mimeMatch?.[1] ?? 'image/jpeg';

  const binaryStr = atob(base64Data ?? '');
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return new File([bytes], filename, { type: mimeType });
}

export function CameraWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: CameraWindowProps) {
  const { uploadFile } = useFileUpload();
  const { addPhotoToAlbum, getPhotoRollAlbum } = usePhotoAlbums();

  const handlePhotoAccepted = useCallback(
    async (dataUrl: string) => {
      try {
        const filename = `photo-${Date.now()}.jpg`;
        const file = dataUrlToFile(dataUrl, filename);

        const result = await uploadFile(file);

        const photoRoll = getPhotoRollAlbum();
        if (photoRoll) {
          await addPhotoToAlbum(photoRoll.id, result.id);
        }
      } catch (error) {
        console.error('Failed to save photo:', error);
      }
    },
    [uploadFile, addPhotoToAlbum, getPhotoRollAlbum]
  );

  return (
    <CameraWindowBase
      id={id}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      initialDimensions={initialDimensions}
      onPhotoAccepted={handlePhotoAccepted}
    />
  );
}
