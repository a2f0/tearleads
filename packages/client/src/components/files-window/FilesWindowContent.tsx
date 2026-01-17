import { forwardRef, useImperativeHandle, useRef } from 'react';
import { FilesList, type FilesListRef } from '@/components/files';

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
  const filesListRef = useRef<FilesListRef>(null);

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
      <FilesList
        ref={filesListRef}
        showDeleted={showDeleted}
        showHeader={false}
      />
    </div>
  );
});
