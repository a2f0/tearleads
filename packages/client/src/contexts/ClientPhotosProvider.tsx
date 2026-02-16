/**
 * Client-side PhotosUIProvider wrapper that supplies all dependencies
 * to the @tearleads/photos package components.
 */

import { useMultiFileUpload } from '@tearleads/audio';
import type { TranslationFunction } from '@tearleads/photos';
import {
  type PhotoAlbum,
  type PhotoInfo,
  type PhotosUIComponents,
  PhotosUIProvider,
  type PhotoWithUrl
} from '@tearleads/photos';
import photosPackageJson from '@tearleads/photos/package.json';
import { assertPlainArrayBuffer, setMediaDragData } from '@tearleads/shared';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { type ReactNode, useCallback, useMemo } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ActionToolbar } from '@/components/ui/ActionToolbar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { EditableTitle } from '@/components/ui/editable-title';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/ListRow';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { UploadProgress } from '@/components/ui/UploadProgress';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { zIndex } from '@/constants/zIndex';
import {
  useWindowManagerActions,
  type WindowOpenRequestPayloads,
  type WindowType
} from '@/contexts/WindowManagerContext';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { albums, files, vfsLinks, vfsRegistry } from '@/db/schema';
import { useDropZone } from '@/hooks/useDropZone';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useTypedTranslation } from '@/i18n';
import { uint8ArrayToDataUrl } from '@/lib/chatAttachments';
import { canShareFiles, downloadFile, shareFile } from '@/lib/fileUtils';
import { setAttachedImage } from '@/lib/llmRuntime';
import { formatDate, formatFileSize } from '@/lib/utils';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { logStore } from '@/stores/logStore';

export function PhotosAboutMenuItem() {
  return <AboutMenuItem appName="Photos" version={photosPackageJson.version} />;
}

const photosUIComponents: PhotosUIComponents = {
  Button,
  Input,
  ContextMenu,
  ContextMenuItem,
  ListRow,
  RefreshButton,
  VirtualListStatus,
  InlineUnlock,
  EditableTitle,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem,
  AboutMenuItem: PhotosAboutMenuItem,
  Dropzone,
  UploadProgress,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  ActionToolbar
};

interface ClientPhotosProviderProps {
  children: ReactNode;
}

export function ClientPhotosProvider({ children }: ClientPhotosProviderProps) {
  const databaseContext = useDatabaseContext();
  const { t: tContextMenu } = useTypedTranslation('contextMenu');
  const { t: tMenu } = useTypedTranslation('menu');
  const { t: tCommon } = useTypedTranslation('common');
  const { uploadFile: fileUpload } = useFileUpload();
  const { openWindow, requestWindowOpen } = useWindowManagerActions();

  const t: TranslationFunction = useCallback(
    (key, options) => {
      const contextMenuKeys = [
        'getInfo',
        'delete',
        'restore',
        'download',
        'share'
      ] as const;
      const menuKeys = ['photos'] as const;
      const commonKeys = ['loading', 'create', 'cancel'] as const;

      if (contextMenuKeys.includes(key as (typeof contextMenuKeys)[number])) {
        return tContextMenu(key as 'getInfo' | 'delete', options);
      }
      if (menuKeys.includes(key as (typeof menuKeys)[number])) {
        return tMenu(key as 'photos', options);
      }
      if (commonKeys.includes(key as (typeof commonKeys)[number])) {
        return tCommon(key as 'loading' | 'create', options);
      }

      // Fallback translations for photos-specific keys
      const fallbacks: Record<string, string> = {
        addToAIChat: 'Add to AI chat',
        upload: 'Upload',
        allPhotos: 'All Photos',
        albums: 'Albums',
        searchPhotos: 'Search photos',
        noPhotos: 'No photos',
        photoCount:
          options?.['count'] === 1
            ? '1 photo'
            : `${options?.['count'] ?? 0} photos`,
        uploadProgress: 'Uploading...',
        uploading: 'Uploading',
        photoDetails: 'Photo Details',
        back: 'Back',
        loadingDatabase: 'Loading database...',
        loadingPhotos: 'Loading photos...',
        type: 'Type',
        size: 'Size',
        name: 'Name',
        date: 'Date',
        uploaded: 'Uploaded',
        newAlbum: 'New Album',
        renameAlbum: 'Rename Album',
        deleteAlbum: 'Delete Album',
        albumName: 'Album Name',
        rename: 'Rename',
        confirmDeleteAlbum: 'Are you sure you want to delete this album?'
      };

      return fallbacks[key] ?? key;
    },
    [tContextMenu, tMenu, tCommon]
  );

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

  const loadPhotoWithUrl = useCallback(
    async (photo: PhotoInfo): Promise<PhotoWithUrl | null> => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!databaseContext.currentInstanceId)
        throw new Error('No active instance');

      if (!isFileStorageInitialized(databaseContext.currentInstanceId)) {
        await initializeFileStorage(
          encryptionKey,
          databaseContext.currentInstanceId
        );
      }

      const storage = getFileStorage();
      try {
        const pathToLoad = photo.thumbnailPath ?? photo.storagePath;
        const mimeType = photo.thumbnailPath ? 'image/jpeg' : photo.mimeType;
        const data = await storage.retrieve(pathToLoad);
        assertPlainArrayBuffer(data);
        const blob = new Blob([data], { type: mimeType });
        const objectUrl = URL.createObjectURL(blob);
        return { ...photo, objectUrl };
      } catch (err) {
        logStore.error(`Failed to load photo ${photo.name}`, String(err));
        return null;
      }
    },
    [databaseContext.currentInstanceId]
  );

  const fetchPhotos = useCallback(
    async (options: {
      albumId?: string | null;
      includeDeleted?: boolean;
    }): Promise<PhotoWithUrl[]> => {
      const { albumId, includeDeleted = false } = options;
      const db = getDatabase();
      const ALL_PHOTOS_ID = '__all__';

      // If a specific album is selected, get the photo IDs in that album
      let photoIdsInAlbum: string[] | null = null;
      if (albumId && albumId !== ALL_PHOTOS_ID) {
        const albumLinks = await db
          .select({ childId: vfsLinks.childId })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, albumId));
        photoIdsInAlbum = albumLinks.map((l) => l.childId);

        // If album is empty, return early
        if (photoIdsInAlbum.length === 0) {
          return [];
        }
      }

      // Build the where clause
      const baseConditions = and(
        like(files.mimeType, 'image/%'),
        includeDeleted ? undefined : eq(files.deleted, false)
      );
      const whereClause = photoIdsInAlbum
        ? and(baseConditions, inArray(files.id, photoIdsInAlbum))
        : baseConditions;

      const result = await db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          uploadDate: files.uploadDate,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath,
          deleted: files.deleted
        })
        .from(files)
        .where(whereClause)
        .orderBy(desc(files.uploadDate));

      const photoList: PhotoInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath,
        deleted: row.deleted
      }));

      const photosWithUrls = (
        await Promise.all(photoList.map(loadPhotoWithUrl))
      ).filter((photo): photo is PhotoWithUrl => photo !== null);

      return photosWithUrls;
    },
    [loadPhotoWithUrl]
  );

  const fetchPhotoById = useCallback(
    async (photoId: string): Promise<PhotoWithUrl | null> => {
      const db = getDatabase();

      const result = await db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          uploadDate: files.uploadDate,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath,
          deleted: files.deleted
        })
        .from(files)
        .where(and(eq(files.id, photoId), like(files.mimeType, 'image/%')))
        .limit(1);

      const row = result[0];
      if (!row) {
        return null;
      }

      const photo: PhotoInfo = {
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath,
        deleted: row.deleted
      };

      return loadPhotoWithUrl(photo);
    },
    [loadPhotoWithUrl]
  );

  const softDeletePhoto = useCallback(
    async (photoId: string): Promise<void> => {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, photoId));
    },
    []
  );

  const restorePhoto = useCallback(async (photoId: string): Promise<void> => {
    const db = getDatabase();
    await db.update(files).set({ deleted: false }).where(eq(files.id, photoId));
  }, []);

  const downloadPhotoData = useCallback(
    async (photo: PhotoWithUrl): Promise<Uint8Array> => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!databaseContext.currentInstanceId)
        throw new Error('No active instance');

      if (!isFileStorageInitialized(databaseContext.currentInstanceId)) {
        await initializeFileStorage(
          encryptionKey,
          databaseContext.currentInstanceId
        );
      }

      const storage = getFileStorage();
      const data = await storage.retrieve(photo.storagePath);
      assertPlainArrayBuffer(data);
      return new Uint8Array(data);
    },
    [databaseContext.currentInstanceId]
  );

  const sharePhotoData = useCallback(
    async (photo: PhotoWithUrl): Promise<Uint8Array> => {
      // Same implementation as downloadPhotoData - get the full file
      return downloadPhotoData(photo);
    },
    [downloadPhotoData]
  );

  const fetchAlbums = useCallback(async (): Promise<PhotoAlbum[]> => {
    const db = getDatabase();

    // Get all albums with their names and types
    const albumRows = await db
      .select({
        id: vfsRegistry.id,
        name: albums.encryptedName,
        coverPhotoId: albums.coverPhotoId,
        albumType: albums.albumType
      })
      .from(vfsRegistry)
      .innerJoin(albums, eq(albums.id, vfsRegistry.id))
      .where(eq(vfsRegistry.objectType, 'album'));

    if (albumRows.length === 0) {
      return [];
    }

    const albumIds = albumRows.map((a) => a.id);

    // Get photo counts for each album (excluding deleted files)
    const childCountRows = await db
      .select({
        parentId: vfsLinks.parentId
      })
      .from(vfsLinks)
      .innerJoin(files, eq(files.id, vfsLinks.childId))
      .where(
        and(inArray(vfsLinks.parentId, albumIds), eq(files.deleted, false))
      );

    const photoCountMap = new Map<string, number>();
    for (const row of childCountRows) {
      photoCountMap.set(
        row.parentId,
        (photoCountMap.get(row.parentId) || 0) + 1
      );
    }

    const result: PhotoAlbum[] = albumRows.map((album) => ({
      id: album.id,
      name: album.name || 'Unnamed Album',
      photoCount: photoCountMap.get(album.id) || 0,
      coverPhotoId: album.coverPhotoId,
      albumType: (album.albumType || 'custom') as 'photoroll' | 'custom'
    }));

    // Sort: system albums first, then alphabetically
    result.sort((a, b) => {
      const aIsSystem = a.albumType === 'photoroll';
      const bIsSystem = b.albumType === 'photoroll';
      if (aIsSystem && !bIsSystem) return -1;
      if (!aIsSystem && bIsSystem) return 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }, []);

  const createAlbum = useCallback(async (name: string): Promise<string> => {
    const db = getDatabase();
    const albumId = crypto.randomUUID();
    const now = new Date();

    await db.insert(vfsRegistry).values({
      id: albumId,
      objectType: 'album',
      ownerId: null,
      createdAt: now
    });

    await db.insert(albums).values({
      id: albumId,
      encryptedName: name,
      encryptedDescription: null,
      coverPhotoId: null
    });

    return albumId;
  }, []);

  const renameAlbum = useCallback(
    async (albumId: string, newName: string): Promise<void> => {
      const db = getDatabase();
      await db
        .update(albums)
        .set({ encryptedName: newName })
        .where(eq(albums.id, albumId));
    },
    []
  );

  const deleteAlbum = useCallback(async (albumId: string): Promise<void> => {
    const db = getDatabase();

    // Delete links first (photos stay, just unlinked from album)
    await db.delete(vfsLinks).where(eq(vfsLinks.parentId, albumId));

    // Delete album metadata
    await db.delete(albums).where(eq(albums.id, albumId));

    // Delete registry entry
    await db.delete(vfsRegistry).where(eq(vfsRegistry.id, albumId));
  }, []);

  const addPhotoToAlbum = useCallback(
    async (albumId: string, photoId: string): Promise<void> => {
      const db = getDatabase();
      const linkId = crypto.randomUUID();
      const now = new Date();

      // Check if link already exists
      const existing = await db
        .select({ id: vfsLinks.id })
        .from(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, albumId), eq(vfsLinks.childId, photoId))
        );

      if (existing.length > 0) {
        return; // Already linked
      }

      await db.insert(vfsLinks).values({
        id: linkId,
        parentId: albumId,
        childId: photoId,
        wrappedSessionKey: '',
        createdAt: now
      });
    },
    []
  );

  const removePhotoFromAlbum = useCallback(
    async (albumId: string, photoId: string): Promise<void> => {
      const db = getDatabase();
      await db
        .delete(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, albumId), eq(vfsLinks.childId, photoId))
        );
    },
    []
  );

  const getPhotoIdsInAlbum = useCallback(
    async (albumId: string): Promise<string[]> => {
      const db = getDatabase();
      const links = await db
        .select({ childId: vfsLinks.childId })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, albumId));
      return links.map((l) => l.childId);
    },
    []
  );

  const uploadFile = useCallback(
    async (
      file: File,
      onProgress?: (progress: number) => void
    ): Promise<string> => {
      const result = await fileUpload(file, onProgress);
      return result.id;
    },
    [fileUpload]
  );

  const handleDownloadFile = useCallback(
    (data: Uint8Array, filename: string): void => {
      downloadFile(data, filename);
    },
    []
  );

  const handleShareFile = useCallback(
    async (
      data: Uint8Array,
      filename: string,
      mimeType: string
    ): Promise<boolean> => {
      return shareFile(data, filename, mimeType);
    },
    []
  );

  const handleOpenWindow = useCallback(
    (windowType: string): void => {
      openWindow(windowType as WindowType);
    },
    [openWindow]
  );

  const handleRequestWindowOpen = useCallback(
    (windowType: string, payload: Record<string, unknown>): void => {
      requestWindowOpen(
        windowType as keyof WindowOpenRequestPayloads,
        payload as WindowOpenRequestPayloads[keyof WindowOpenRequestPayloads]
      );
    },
    [requestWindowOpen]
  );

  const logError = useCallback(
    (message: string, details?: string) => logStore.error(message, details),
    []
  );

  const logWarn = useCallback(
    (message: string, details?: string) => logStore.warn(message, details),
    []
  );

  const handleSetAttachedImage = useCallback((dataUrl: string): void => {
    setAttachedImage(dataUrl);
  }, []);

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
