import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDropZone } from './useDropZone';

// Mock detectPlatform to return 'web' by default
vi.mock('@/lib/utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...original,
    detectPlatform: vi.fn(() => 'web')
  };
});

function createMockDragEvent(
  files: File[] = [],
  overrides: Partial<React.DragEvent> = {}
): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      files: files as unknown as FileList
    },
    ...overrides
  } as unknown as React.DragEvent;
}

function createMockFile(name: string, type: string): File {
  return new File(['content'], name, { type });
}

describe('useDropZone', () => {
  describe('basic functionality', () => {
    it('returns isDragging as false initially', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));

      expect(result.current.isDragging).toBe(false);
    });

    it('returns dropZoneProps with all required handlers', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));

      expect(result.current.dropZoneProps.onDragOver).toBeDefined();
      expect(result.current.dropZoneProps.onDragEnter).toBeDefined();
      expect(result.current.dropZoneProps.onDragLeave).toBeDefined();
      expect(result.current.dropZoneProps.onDrop).toBeDefined();
    });
  });

  describe('drag events', () => {
    it('sets isDragging to true on dragEnter', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
      });

      expect(result.current.isDragging).toBe(true);
    });

    it('sets isDragging to false on dragLeave', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
      });
      expect(result.current.isDragging).toBe(true);

      act(() => {
        result.current.dropZoneProps.onDragLeave(createMockDragEvent());
      });
      expect(result.current.isDragging).toBe(false);
    });

    it('handles nested drag events using counter pattern', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));

      // Enter parent element
      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
      });
      expect(result.current.isDragging).toBe(true);

      // Enter child element (simulates nested drag)
      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
      });
      expect(result.current.isDragging).toBe(true);

      // Leave child element
      act(() => {
        result.current.dropZoneProps.onDragLeave(createMockDragEvent());
      });
      expect(result.current.isDragging).toBe(true);

      // Leave parent element
      act(() => {
        result.current.dropZoneProps.onDragLeave(createMockDragEvent());
      });
      expect(result.current.isDragging).toBe(false);
    });

    it('prevents default on dragOver', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));
      const event = createMockDragEvent();

      act(() => {
        result.current.dropZoneProps.onDragOver(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('drop handling', () => {
    it('calls onDrop with dropped files', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));
      const file = createMockFile('photo.jpg', 'image/jpeg');

      act(() => {
        result.current.dropZoneProps.onDrop(createMockDragEvent([file]));
      });

      expect(onDrop).toHaveBeenCalledWith([file]);
    });

    it('resets isDragging on drop', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));
      const file = createMockFile('photo.jpg', 'image/jpeg');

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
      });
      expect(result.current.isDragging).toBe(true);

      act(() => {
        result.current.dropZoneProps.onDrop(createMockDragEvent([file]));
      });
      expect(result.current.isDragging).toBe(false);
    });

    it('does not call onDrop when no files are dropped', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));

      act(() => {
        result.current.dropZoneProps.onDrop(createMockDragEvent([]));
      });

      expect(onDrop).not.toHaveBeenCalled();
    });
  });

  describe('file filtering', () => {
    it('filters files based on accept string', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() =>
        useDropZone({ onDrop, accept: 'image/*' })
      );
      const imageFile = createMockFile('photo.jpg', 'image/jpeg');
      const videoFile = createMockFile('video.mp4', 'video/mp4');

      act(() => {
        result.current.dropZoneProps.onDrop(
          createMockDragEvent([imageFile, videoFile])
        );
      });

      expect(onDrop).toHaveBeenCalledWith([imageFile]);
    });

    it('accepts all files when no accept string is provided', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));
      const imageFile = createMockFile('photo.jpg', 'image/jpeg');
      const videoFile = createMockFile('video.mp4', 'video/mp4');

      act(() => {
        result.current.dropZoneProps.onDrop(
          createMockDragEvent([imageFile, videoFile])
        );
      });

      expect(onDrop).toHaveBeenCalledWith([imageFile, videoFile]);
    });

    it('does not call onDrop when all files are filtered out', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() =>
        useDropZone({ onDrop, accept: 'image/*' })
      );
      const videoFile = createMockFile('video.mp4', 'video/mp4');

      act(() => {
        result.current.dropZoneProps.onDrop(createMockDragEvent([videoFile]));
      });

      expect(onDrop).not.toHaveBeenCalled();
    });
  });

  describe('disabled state', () => {
    it('does not set isDragging when disabled', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() =>
        useDropZone({ onDrop, disabled: true })
      );

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
      });

      expect(result.current.isDragging).toBe(false);
    });

    it('does not call onDrop when disabled', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() =>
        useDropZone({ onDrop, disabled: true })
      );
      const file = createMockFile('photo.jpg', 'image/jpeg');

      act(() => {
        result.current.dropZoneProps.onDrop(createMockDragEvent([file]));
      });

      expect(onDrop).not.toHaveBeenCalled();
    });

    it('does not prevent default when disabled', () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() =>
        useDropZone({ onDrop, disabled: true })
      );
      const event = createMockDragEvent();

      act(() => {
        result.current.dropZoneProps.onDragOver(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('does not call onDragLeave when disabled', () => {
      const onDrop = vi.fn();
      const onDragLeave = vi.fn();
      const { result } = renderHook(() =>
        useDropZone({ onDrop, onDragLeave, disabled: true })
      );

      act(() => {
        result.current.dropZoneProps.onDragLeave(createMockDragEvent());
      });

      expect(onDragLeave).not.toHaveBeenCalled();
    });
  });

  describe('callbacks', () => {
    it('calls onDragEnter callback when dragging enters', () => {
      const onDrop = vi.fn();
      const onDragEnter = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop, onDragEnter }));

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
      });

      expect(onDragEnter).toHaveBeenCalledTimes(1);
    });

    it('calls onDragLeave callback when dragging leaves', () => {
      const onDrop = vi.fn();
      const onDragLeave = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop, onDragLeave }));

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
        result.current.dropZoneProps.onDragLeave(createMockDragEvent());
      });

      expect(onDragLeave).toHaveBeenCalledTimes(1);
    });

    it('calls onDragLeave callback on drop', () => {
      const onDrop = vi.fn();
      const onDragLeave = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop, onDragLeave }));
      const file = createMockFile('photo.jpg', 'image/jpeg');

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
        result.current.dropZoneProps.onDrop(createMockDragEvent([file]));
      });

      expect(onDragLeave).toHaveBeenCalledTimes(1);
    });

    it('only calls onDragEnter once for nested drag events', () => {
      const onDrop = vi.fn();
      const onDragEnter = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop, onDragEnter }));

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
      });

      expect(onDragEnter).toHaveBeenCalledTimes(1);
    });
  });

  describe('platform detection', () => {
    it('disables drop zone on iOS', async () => {
      const { detectPlatform } = await import('@/lib/utils');
      vi.mocked(detectPlatform).mockReturnValue('ios');

      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));
      const file = createMockFile('photo.jpg', 'image/jpeg');

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
        result.current.dropZoneProps.onDrop(createMockDragEvent([file]));
      });

      expect(result.current.isDragging).toBe(false);
      expect(onDrop).not.toHaveBeenCalled();

      vi.mocked(detectPlatform).mockReturnValue('web');
    });

    it('disables drop zone on Android', async () => {
      const { detectPlatform } = await import('@/lib/utils');
      vi.mocked(detectPlatform).mockReturnValue('android');

      const onDrop = vi.fn();
      const { result } = renderHook(() => useDropZone({ onDrop }));
      const file = createMockFile('photo.jpg', 'image/jpeg');

      act(() => {
        result.current.dropZoneProps.onDragEnter(createMockDragEvent());
        result.current.dropZoneProps.onDrop(createMockDragEvent([file]));
      });

      expect(result.current.isDragging).toBe(false);
      expect(onDrop).not.toHaveBeenCalled();

      vi.mocked(detectPlatform).mockReturnValue('web');
    });
  });
});
