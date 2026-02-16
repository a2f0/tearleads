/**
 * Photos window wrapper that provides client-side dependencies
 * to the @tearleads/photos package components.
 */

import { PhotosWindow as PhotosWindowBase } from '@tearleads/photos';
import type { WindowDimensions } from '@tearleads/window-manager';
import { DropZoneOverlay } from '@/components/ui/drop-zone-overlay';
import { ClientPhotosProvider } from '@/contexts/ClientPhotosProvider';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';
import { filterFilesByAccept } from '@/lib/fileFilter';
import { getMediaDragIds } from '@/lib/mediaDragData';

interface PhotosWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function PhotosWindow(props: PhotosWindowProps) {
  const openRequest = useWindowOpenRequest('photos');

  return (
    <ClientPhotosProvider>
      <PhotosWindowBase
        {...props}
        openRequest={openRequest}
        DropZoneOverlay={DropZoneOverlay}
        filterFilesByAccept={filterFilesByAccept}
        getMediaDragIds={getMediaDragIds}
      />
    </ClientPhotosProvider>
  );
}
