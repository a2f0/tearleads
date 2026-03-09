import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMultiFileUpload } from './useMultiFileUpload';

describe('audio useMultiFileUpload', () => {
  it('uploads files and returns uploaded IDs', async () => {
    const uploadFile = vi.fn(
      async (file: File, onProgress: (progress: number) => void) => {
        onProgress(100);
        return `uploaded-${file.name}`;
      }
    );
    const files = [
      new File(['track-a'], 'first.mp3', { type: 'audio/mpeg' }),
      new File(['track-b'], 'second.mp3', { type: 'audio/mpeg' })
    ];
    const { result } = renderHook(() => useMultiFileUpload({ uploadFile }));

    let uploadResult:
      | {
          results: string[];
          errors: Array<{ fileName: string; message: string }>;
        }
      | undefined;
    await act(async () => {
      uploadResult = await result.current.uploadMany(files);
    });

    expect(uploadResult).toEqual({
      results: ['uploaded-first.mp3', 'uploaded-second.mp3'],
      errors: []
    });
  });
});
