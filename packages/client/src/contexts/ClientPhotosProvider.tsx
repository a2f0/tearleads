/**
 * Client-side PhotosUIProvider wrapper that supplies all dependencies
 * to the @tearleads/photos package components.
 */

import { useMultiFileUpload } from '@tearleads/audio';
import { PhotosUIProvider } from '@tearleads/photos';
import { setMediaDragData } from '@tearleads/shared';
import { type ReactNode, useMemo } from 'react';
import { zIndex } from '@/constants/zIndex';
import { useDatabaseContext } from '@/db/hooks';
import { useDropZone } from '@/hooks/dnd';
import { uint8ArrayToDataUrl } from '@/lib/chatAttachments';
import { formatDate, formatFileSize } from '@/lib/utils';
import {
  PhotosAboutMenuItem,
  photosUIComponents,
  usePhotosActions,
  usePhotosAlbums,
  usePhotosData,
  usePhotosTranslation
} from './photos-provider';

export { PhotosAboutMenuItem };

interface ClientPhotosProviderProps {
  children: ReactNode;
}

export function ClientPhotosProvider({ children }: ClientPhotosProviderProps) {
  const databaseContext = useDatabaseContext();
  const t = usePhotosTranslation();

  const {
    fetchPhotos,
    fetchPhotoById,
    softDeletePhoto,
    restorePhoto,
    downloadPhotoData,
    sharePhotoData
  } = usePhotosData();

  const {
    fetchAlbums,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    addPhotoToAlbum,
    removePhotoFromAlbum,
    getPhotoIdsInAlbum
  } = usePhotosAlbums();

  const {
    uploadFile,
    handleDownloadFile,
    handleShareFile,
    canShareFiles,
    handleOpenWindow,
    handleRequestWindowOpen,
    logError,
    logWarn,
    handleSetAttachedImage
  } = usePhotosActions();

  const databaseState = useMemo(
    () => ({
      isUnlocked: databaseContext.isUnlocked,
      isLoading: databaseContext.isLoading,
      currentInstanceId: databaseContext.currentInstanceId
    }),
    [
      databaseContext.isUnlocked,
      databaseContext.isLoading,
      databaseContext.currentInstanceId
    ]
  );

  return (
    <PhotosUIProvider
      databaseState={databaseState}
      ui={photosUIComponents}
      t={t}
      tooltipZIndex={zIndex.tooltip}
      fetchPhotos={fetchPhotos}
      fetchPhotoById={fetchPhotoById}
      softDeletePhoto={softDeletePhoto}
      restorePhoto={restorePhoto}
      downloadPhotoData={downloadPhotoData}
      sharePhotoData={sharePhotoData}
      fetchAlbums={fetchAlbums}
      createAlbum={createAlbum}
      renameAlbum={renameAlbum}
      deleteAlbum={deleteAlbum}
      addPhotoToAlbum={addPhotoToAlbum}
      removePhotoFromAlbum={removePhotoFromAlbum}
      getPhotoIdsInAlbum={getPhotoIdsInAlbum}
      uploadFile={uploadFile}
      downloadFile={handleDownloadFile}
      shareFile={handleShareFile}
      canShareFiles={canShareFiles}
      useDropZone={useDropZone}
      useMultiFileUpload={useMultiFileUpload}
      formatFileSize={formatFileSize}
      formatDate={formatDate}
      uint8ArrayToDataUrl={uint8ArrayToDataUrl}
      setMediaDragData={setMediaDragData}
      setAttachedImage={handleSetAttachedImage}
      logError={logError}
      logWarn={logWarn}
      openWindow={handleOpenWindow}
      requestWindowOpen={handleRequestWindowOpen}
    >
      {children}
    </PhotosUIProvider>
  );
}
