import { Upload } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import {
  type FilePickerSource,
  useNativeFilePicker
} from '@/hooks/useNativeFilePicker';
import { cn, detectPlatform } from '@/lib/utils';

import { Button } from './button';

export interface DropzoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Label for the files (e.g., "files", "photos", "documents"). Defaults to "files". */
  label?: string;
  /**
   * The source to pick files from on iOS:
   * - 'files': Document picker (Files app) - default
   * - 'photos': Photo library (images only)
   * - 'media': Photo library (images and videos)
   */
  source?: FilePickerSource;
  /** Show icon-only compact version (for grid layouts) */
  compact?: boolean;
}

export function Dropzone({
  onFilesSelected,
  accept,
  multiple = true,
  className,
  disabled = false,
  style,
  label = 'files',
  source,
  compact = false
}: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const platform = detectPlatform();
  const isNative = platform === 'ios' || platform === 'android';
  const { pickFiles, isNativePicker } = useNativeFilePicker();

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

  const handleClick = useCallback(async () => {
    if (disabled || isPickerOpen) return;

    // Use native file picker on iOS
    if (isNativePicker) {
      setIsPickerOpen(true);
      try {
        const files = await pickFiles({ accept, multiple, source });
        if (files && files.length > 0) {
          onFilesSelected(files);
        }
      } catch (err) {
        // Distinguish between user cancellation and actual errors
        if (getErrorCode(err) === 'CANCELLED') {
          console.debug('Native file picker cancelled by user.');
        } else {
          console.error('Native file picker failed:', err);
        }
      } finally {
        setIsPickerOpen(false);
      }
      return;
    }

    // Fall back to HTML input for other platforms
    inputRef.current?.click();
  }, [
    disabled,
    isPickerOpen,
    isNativePicker,
    pickFiles,
    accept,
    multiple,
    source,
    onFilesSelected
  ]);

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
    if (compact) {
      return (
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled || isPickerOpen}
          data-testid="dropzone-native"
          data-platform={platform}
          className={cn(
            'flex aspect-square cursor-pointer items-center justify-center rounded-lg border bg-muted transition-all hover:ring-2 hover:ring-primary hover:ring-offset-2',
            disabled && 'cursor-not-allowed opacity-50',
            className
          )}
          style={style}
        >
          <Upload
            className={cn(
              'h-6 w-6 text-muted-foreground/50',
              isPickerOpen && 'animate-pulse'
            )}
          />
          {fileInput}
        </button>
      );
    }

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
          disabled={disabled || isPickerOpen}
          data-testid="dropzone-choose-files"
        >
          <Upload className="mr-2 h-5 w-5" />
          {isPickerOpen
            ? 'Selecting...'
            : `Choose ${label.charAt(0).toUpperCase() + label.slice(1)}`}
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
      style={style}
    >
      <Upload
        className={cn(
          'h-10 w-10 text-muted-foreground/50',
          isDragging && 'text-primary'
        )}
      />
      <div className="text-center">
        <p className="font-medium text-sm">
          {isDragging ? `Drop ${label} here` : `Drag and drop ${label} here`}
        </p>
        <p className="text-muted-foreground text-xs">or click to browse</p>
      </div>
      {fileInput}
    </label>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}
