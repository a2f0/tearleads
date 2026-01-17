import { forwardRef, useImperativeHandle, useRef } from 'react';
import { FilesList } from '@/components/files';

export interface FilesWindowContentRef {
  uploadFiles: (files: File[]) => void;
}

interface FilesWindowContentProps {
  showDeleted: boolean;
}

export const FilesWindowContent = forwardRef<
  FilesWindowContentRef,
  FilesWindowContentProps
>(function FilesWindowContent({ showDeleted }, ref) {
  const filesListRef = useRef<{ triggerUpload?: (files: File[]) => void }>(
    null
  );

  useImperativeHandle(
    ref,
    () => ({
      uploadFiles: (files: File[]) => {
        filesListRef.current?.triggerUpload?.(files);
      }
    }),
    []
  );

  return (
    <div className="h-full overflow-auto p-3">
      <FilesList showDeleted={showDeleted} showHeader={false} />
    </div>
  );
});
