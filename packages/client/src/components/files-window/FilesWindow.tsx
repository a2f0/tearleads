import { useCallback, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import type { FilesWindowContentRef } from './FilesWindowContent';
import { FilesWindowContent } from './FilesWindowContent';
import { FilesWindowMenuBar } from './FilesWindowMenuBar';

interface FilesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function FilesWindow({
  id,
  onClose,
  onMinimize,
  onFocus,
  zIndex,
  initialDimensions
}: FilesWindowProps) {
  const [showDeleted, setShowDeleted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<FilesWindowContentRef>(null);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        contentRef.current?.uploadFiles(files);
      }
      // Reset input so the same file can be selected again
      e.target.value = '';
    },
    []
  );

  return (
    <FloatingWindow
      id={id}
      title="Files"
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={800}
      defaultHeight={600}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <FilesWindowMenuBar
          showDeleted={showDeleted}
          onShowDeletedChange={setShowDeleted}
          onUpload={handleUpload}
          onClose={onClose}
        />
        <div className="flex-1 overflow-hidden">
          <FilesWindowContent ref={contentRef} showDeleted={showDeleted} />
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="file-input"
      />
    </FloatingWindow>
  );
}
