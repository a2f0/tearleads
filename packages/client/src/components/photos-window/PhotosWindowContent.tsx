import { Loader2 } from 'lucide-react';
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useImperativeHandle,
  useState
} from 'react';
import { useFileUpload } from '@/hooks/useFileUpload';

export interface PhotosWindowContentRef {
  uploadFiles: (files: File[]) => void;
  refresh: () => void;
}

// Dynamic import to load Photos page component
const PhotosPageModule = import('@/pages/Photos');

const Photos = lazy(() =>
  PhotosPageModule.then((m) => ({ default: m.Photos }))
);

export const PhotosWindowContent = forwardRef<PhotosWindowContentRef>(
  function PhotosWindowContent(_props, ref) {
    const { uploadFile } = useFileUpload();
    const [refreshKey, setRefreshKey] = useState(0);

    const handleUploadFiles = useCallback(
      async (files: File[]) => {
        await Promise.all(
          files.map(async (file) => {
            try {
              await uploadFile(file);
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
            }
          })
        );
        // Trigger refresh after uploads
        setRefreshKey((k) => k + 1);
      },
      [uploadFile]
    );

    const handleRefresh = useCallback(() => {
      setRefreshKey((k) => k + 1);
    }, []);

    useImperativeHandle(ref, () => ({
      uploadFiles: handleUploadFiles,
      refresh: handleRefresh
    }));

    // Render Photos page directly - it handles all the photo grid logic
    return <LazyPhotos key={refreshKey} />;
  }
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
