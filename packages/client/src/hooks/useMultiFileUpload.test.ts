import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMultiFileUpload } from './useMultiFileUpload';

describe('useMultiFileUpload', () => {
  it('uploads files and returns results', async () => {
    const uploadFile = vi.fn(
      async (file: File, onProgress: (progress: number) => void) => {
        onProgress(100);
        return { id: `uploaded-${file.name}` };
      }
    );
    const files = [
      new File(['a'], 'first.png', { type: 'image/png' }),
      new File(['b'], 'second.png', { type: 'image/png' })
    ];
    const { result } = renderHook(() => useMultiFileUpload({ uploadFile }));

    let uploadResult:
      | {
          results: Array<{ id: string }>;
          errors: Array<{ fileName: string; message: string }>;
        }
      | undefined;
    await act(async () => {
      uploadResult = await result.current.uploadMany(files);
    });

    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadResult).toEqual({
      results: [{ id: 'uploaded-first.png' }, { id: 'uploaded-second.png' }],
      errors: []
    });
    expect(result.current.uploading).toBe(false);
    expect(result.current.uploadProgress).toBe(0);
  });

  it('records validation and upload failures', async () => {
    const uploadFile = vi.fn(
      async (file: File, _onProgress: (progress: number) => void) => {
        if (file.name === 'broken.png') {
          throw new Error('Upload failed');
        }
        return { id: `uploaded-${file.name}` };
      }
    );
    const validateFile = vi.fn((file: File) =>
      file.type === 'text/plain' ? 'Unsupported type' : null
    );
    const files = [
      new File(['a'], 'good.png', { type: 'image/png' }),
      new File(['b'], 'bad.txt', { type: 'text/plain' }),
      new File(['c'], 'broken.png', { type: 'image/png' })
    ];
    const { result } = renderHook(() =>
      useMultiFileUpload({ uploadFile, validateFile })
    );

    let uploadResult:
      | {
          results: Array<{ id: string }>;
          errors: Array<{ fileName: string; message: string }>;
        }
      | undefined;
    await act(async () => {
      uploadResult = await result.current.uploadMany(files);
    });

    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadResult).toEqual({
      results: [{ id: 'uploaded-good.png' }],
      errors: [
        { fileName: 'bad.txt', message: 'Unsupported type' },
        { fileName: 'broken.png', message: 'Upload failed' }
      ]
    });
  });
});
