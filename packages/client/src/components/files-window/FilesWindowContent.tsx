import { forwardRef, useImperativeHandle, useRef } from 'react';
import { FilesList, type FilesListRef } from '@/components/files';

export interface FilesWindowContentRef {
  uploadFiles: (files: File[]) => void;
}

interface FilesWindowContentProps {
  showDeleted: boolean;
  showDropzone: boolean;
  onSelectFile?: (fileId: string) => void;
  onStatusTextChange?: (text: string) => void;
  refreshToken?: number;
  onUpload?: () => void;
}

export const FilesWindowContent = forwardRef<
  FilesWindowContentRef,
  FilesWindowContentProps
>(function FilesWindowContent(
  {
    showDeleted,
    showDropzone,
    onSelectFile,
    onStatusTextChange,
    refreshToken,
    onUpload
  },
  ref
) {
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
        showDropzone={showDropzone}
        showInlineStatus={false}
        {...(onSelectFile && { onSelectFile })}
        {...(onStatusTextChange && { onStatusTextChange })}
        {...(refreshToken !== undefined && { refreshToken })}
        {...(onUpload && { onUpload })}
      />
    </div>
  );
});
