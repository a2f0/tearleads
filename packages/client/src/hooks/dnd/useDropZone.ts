import { useCallback, useRef, useState } from 'react';
import { filterFilesByAccept } from '@/lib/fileFilter';
import { detectPlatform } from '@/lib/utils';

interface UseDropZoneOptions {
  /** MIME type accept string (e.g., "image/*", "video/*,audio/*", ".iso") */
  accept?: string;
  /** Callback when valid files are dropped */
  onDrop: (files: File[]) => void | Promise<void>;
  /** Whether drop zone is disabled */
  disabled?: boolean;
  /** Callback when dragging enters the zone (optional, for custom effects) */
  onDragEnter?: () => void;
  /** Callback when dragging leaves the zone (optional) */
  onDragLeave?: () => void;
}

interface UseDropZoneReturn {
  /** Whether files are currently being dragged over the zone */
  isDragging: boolean;
  /** Props to spread on the drop zone container */
  dropZoneProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

/**
 * Hook for creating a drag-and-drop file zone.
 *
 * Uses a drag counter pattern to handle nested elements properly.
 * When dragging over child elements, the drag events bubble up,
 * so we track enter/leave counts rather than relying on event targets.
 */
export function useDropZone({
  accept,
  onDrop,
  disabled = false,
  onDragEnter,
  onDragLeave
}: UseDropZoneOptions): UseDropZoneReturn {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const platform = detectPlatform();

  // Drag-drop not supported on iOS/Android
  const isNative = platform === 'ios' || platform === 'android';

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || isNative) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [disabled, isNative]
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || isNative) return;
      e.preventDefault();
      e.stopPropagation();

      dragCounterRef.current++;
      if (dragCounterRef.current === 1) {
        setIsDragging(true);
        onDragEnter?.();
      }
    },
    [disabled, isNative, onDragEnter]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled || isNative) return;
      e.preventDefault();
      e.stopPropagation();

      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
        onDragLeave?.();
      }
    },
    [disabled, isNative, onDragLeave]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled || isNative) return;
      e.preventDefault();
      e.stopPropagation();

      // Reset drag state
      dragCounterRef.current = 0;
      setIsDragging(false);
      onDragLeave?.();

      // Get files from the drop event
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length === 0) return;

      // Filter files based on accept string
      const validFiles = filterFilesByAccept(droppedFiles, accept);
      if (validFiles.length > 0) {
        void onDrop(validFiles);
      }
    },
    [disabled, isNative, accept, onDrop, onDragLeave]
  );

  return {
    isDragging,
    dropZoneProps: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop
    }
  };
}
