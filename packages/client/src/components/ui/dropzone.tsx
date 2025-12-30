import { Upload } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { cn, detectPlatform } from '@/lib/utils';

import { Button } from './button';

export interface DropzoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
  disabled?: boolean;
}

export function Dropzone({
  onFilesSelected,
  accept,
  multiple = true,
  className,
  disabled = false
}: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const platform = detectPlatform();
  const isNative = platform === 'ios' || platform === 'android';

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (disabled) return;
      if (files && files.length > 0) {
        onFilesSelected(Array.from(files));
      }
    },
    [onFilesSelected, disabled]
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
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

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
      disabled={disabled}
      className="hidden"
      data-testid="dropzone-input"
    />
  );

  if (isNative) {
    return (
      <div
        data-testid="dropzone-native"
        data-platform={platform}
        className={cn('flex flex-col items-center gap-4', className)}
      >
        <Button
          onClick={handleClick}
          variant="outline"
          size="lg"
          disabled={disabled}
          data-testid="dropzone-choose-files"
        >
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
      data-testid="dropzone"
      data-slot="dropzone"
      data-dragging={isDragging}
      data-platform={platform}
      onDragOver={disabled ? undefined : handleDragOver}
      onDragLeave={disabled ? undefined : handleDragLeave}
      onDrop={disabled ? undefined : handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-12 transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer border-muted-foreground/25 hover:border-muted-foreground/50',
        isDragging && !disabled && 'border-primary bg-primary/5',
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
        <p className="font-medium text-sm">
          {isDragging ? 'Drop files here' : 'Drag and drop files here'}
        </p>
        <p className="text-muted-foreground text-xs">or click to browse</p>
      </div>
      {fileInput}
    </label>
  );
}
