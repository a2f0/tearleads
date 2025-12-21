import { Upload } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { cn, detectPlatform } from '@/lib/utils';

import { Button } from './button';

export interface DropzoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
}

export function Dropzone({
  onFilesSelected,
  accept,
  multiple = true,
  className
}: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const platform = detectPlatform();
  const isNative = platform === 'ios' || platform === 'android';

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (files && files.length > 0) {
        onFilesSelected(Array.from(files));
      }
    },
    [onFilesSelected]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    },
    [handleFiles]
  );

  const fileInput = (
    <input
      id={inputId}
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      onChange={handleChange}
      className="hidden"
    />
  );

  if (isNative) {
    return (
      <div className={cn('flex flex-col items-center gap-4', className)}>
        <Button onClick={handleClick} variant="outline" size="lg">
          <Upload className="mr-2 h-5 w-5" />
          Choose Files
        </Button>
        {fileInput}
      </div>
    );
  }

  return (
    <label
      htmlFor={inputId}
      data-slot="dropzone"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-12 transition-colors',
        'border-muted-foreground/25 hover:border-muted-foreground/50',
        isDragging && 'border-primary bg-primary/5',
        className
      )}
    >
      <Upload
        className={cn(
          'h-10 w-10 text-muted-foreground/50',
          isDragging && 'text-primary'
        )}
      />
      <div className="text-center">
        <p className="text-sm font-medium">
          {isDragging ? 'Drop files here' : 'Drag and drop files here'}
        </p>
        <p className="text-xs text-muted-foreground">or click to browse</p>
      </div>
      {fileInput}
    </label>
  );
}
