import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { useFileUpload } from '@/hooks/useFileUpload';

export interface PhotosWindowContentRef {
  uploadFiles: (files: File[]) => void;
  refresh: () => void;
}

interface PhotosWindowContentProps {
  onPhotoSelect?: (photoId: string) => void;
}

// Dynamic import to load Photos page component
const PhotosPageModule = import('@/pages/Photos');

export const PhotosWindowContent = forwardRef<
  PhotosWindowContentRef,
  PhotosWindowContentProps
>(function PhotosWindowContent(_props, ref) {
  const { uploadFile } = useFileUpload();
  const refreshTriggerRef = useRef(0);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          await uploadFile(file);
        } catch (err) {
          console.error(`Failed to upload ${file.name}:`, err);
        }
      }
      // Trigger refresh after uploads
      refreshTriggerRef.current += 1;
    },
    [uploadFile]
  );

  const handleRefresh = useCallback(() => {
    refreshTriggerRef.current += 1;
  }, []);

  useImperativeHandle(ref, () => ({
    uploadFiles: handleUploadFiles,
    refresh: handleRefresh
  }));

  // Render Photos page directly - it handles all the photo grid logic
  return <LazyPhotos />;
});

import { Loader2 } from 'lucide-react';
// Lazy-loaded Photos component wrapper
import { lazy, Suspense } from 'react';

const Photos = lazy(() =>
  PhotosPageModule.then((m) => ({ default: m.Photos }))
);

function LazyPhotos() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading...
        </div>
      }
    >
      <Photos />
    </Suspense>
  );
}
