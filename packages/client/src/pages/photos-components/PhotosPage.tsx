/**
 * PhotosPage component - wrapper for Photos with album sidebar.
 */

import { WindowSidebar } from '@tearleads/window-manager';
import { and, eq, inArray } from 'drizzle-orm';
import { Menu } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';
import {
  ALL_PHOTOS_ID,
  PhotosAlbumsSidebar
} from '@/components/window-photos/PhotosAlbumsSidebar';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { vfsLinks } from '@/db/schema';
import { Photos } from './Photos';

export function PhotosPage() {
  const { albumId } = useParams<{ albumId?: string }>();
  const navigate = useNavigate();
  const { isUnlocked } = useDatabaseContext();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  // Derive selected album from URL (or ALL_PHOTOS_ID if no param)
  const selectedAlbumId = albumId ?? ALL_PHOTOS_ID;

  // Navigate on album selection
  const handleAlbumSelect = useCallback(
    (id: string | null) => {
      if (id === ALL_PHOTOS_ID || id === null) {
        navigate('/photos');
      } else {
        navigate(`/photos/albums/${id}`);
      }
    },
    [navigate]
  );

  const handleDropToAlbum = useCallback(
    async (albumId: string, files: File[], photoIds?: string[]) => {
      void files;
      if (!photoIds || photoIds.length === 0) return;
      const db = getDatabase();
      const uniquePhotoIds = Array.from(new Set(photoIds));
      const existingLinks = await db
        .select({ childId: vfsLinks.childId })
        .from(vfsLinks)
        .where(
          and(
            eq(vfsLinks.parentId, albumId),
            inArray(vfsLinks.childId, uniquePhotoIds)
          )
        );

      const existingChildIds = new Set(
        existingLinks.map((link) => link.childId)
      );
      const newPhotoIds = uniquePhotoIds.filter(
        (id) => !existingChildIds.has(id)
      );

      if (newPhotoIds.length > 0) {
        await db.insert(vfsLinks).values(
          newPhotoIds.map((photoId) => ({
            id: crypto.randomUUID(),
            parentId: albumId,
            childId: photoId,
            wrappedSessionKey: '',
            createdAt: new Date()
          }))
        );
      }
      setRefreshToken((value) => value + 1);
    },
    []
  );

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded p-1 hover:bg-accent md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Toggle albums sidebar"
          data-testid="photos-sidebar-toggle"
        >
          <Menu className="h-5 w-5" />
        </button>
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
      </div>
      <div className="flex min-h-0 flex-1">
        <WindowSidebar
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          ariaLabel="Albums"
        >
          {isUnlocked && (
            <PhotosAlbumsSidebar
              selectedAlbumId={selectedAlbumId}
              onAlbumSelect={handleAlbumSelect}
              refreshToken={refreshToken}
              onAlbumChanged={() => setRefreshToken((t) => t + 1)}
              onDropToAlbum={handleDropToAlbum}
            />
          )}
        </WindowSidebar>
        <div className="min-w-0 flex-1 overflow-hidden md:pl-4">
          <Photos
            showBackLink={false}
            selectedAlbumId={
              selectedAlbumId === ALL_PHOTOS_ID ? null : selectedAlbumId
            }
            refreshToken={refreshToken}
          />
        </div>
      </div>
    </div>
  );
}
