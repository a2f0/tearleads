import { vfsLinks } from '@tearleads/db/sqlite';
import { and, eq } from 'drizzle-orm';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDatabaseContext } from '@/db/hooks';
import { useFileUpload } from './useFileUpload';

interface UseVfsUploaderReturn {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  refreshToken: number;
  handleUpload: (folderId: string) => void;
  handleFileInputChange: (
    e: React.ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
}

/**
 * Hook for handling VFS file uploads with folder linking.
 * Uploads files and creates VFS links to the specified folder.
 */
export function useVfsUploader(): UseVfsUploaderReturn {
  const { db } = useDatabaseContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFolderIdRef = useRef<string | null>(null);
  const { uploadFile } = useFileUpload();
  const [refreshToken, setRefreshToken] = useState(0);

  const handleUpload = useCallback((folderId: string) => {
    currentFolderIdRef.current = folderId;
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const folderId = currentFolderIdRef.current;

      if (files.length > 0 && db) {
        await Promise.all(
          files.map(async (file) => {
            try {
              const result = await uploadFile(file);

              // Create VFS link to folder if uploading to a specific folder
              if (folderId) {
                const existing = await db
                  .select({ id: vfsLinks.id })
                  .from(vfsLinks)
                  .where(
                    and(
                      eq(vfsLinks.parentId, folderId),
                      eq(vfsLinks.childId, result.id)
                    )
                  );

                if (existing.length === 0) {
                  const linkId = crypto.randomUUID();
                  const now = new Date();
                  await db.insert(vfsLinks).values({
                    id: linkId,
                    parentId: folderId,
                    childId: result.id,
                    wrappedSessionKey: '',
                    createdAt: now
                  });
                }
              }
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
              toast.error(`Failed to upload ${file.name}. Please try again.`);
            }
          })
        );
        setRefreshToken((value) => value + 1);
      }
      currentFolderIdRef.current = null;
      e.target.value = '';
    },
    [db, uploadFile]
  );

  return {
    fileInputRef,
    refreshToken,
    handleUpload,
    handleFileInputChange
  };
}
