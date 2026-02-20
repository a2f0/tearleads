import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePhotosActions } from './usePhotosActions';

const mockUploadFile = vi.fn();
const mockOpenWindow = vi.fn();
const mockRequestWindowOpen = vi.fn();
const mockDownloadFile = vi.fn();
const mockShareFile = vi.fn();
const mockCanShareFiles = vi.fn();
const mockSetAttachedImage = vi.fn();
const mockLogError = vi.fn();
const mockLogWarn = vi.fn();

vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({
    openWindow: mockOpenWindow,
    requestWindowOpen: mockRequestWindowOpen
  })
}));

vi.mock('@/lib/fileUtils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename),
  shareFile: (data: Uint8Array, filename: string, mimeType: string) =>
    mockShareFile(data, filename, mimeType),
  canShareFiles: () => mockCanShareFiles()
}));

vi.mock('@/lib/llmRuntime', () => ({
  setAttachedImage: (dataUrl: string) => mockSetAttachedImage(dataUrl)
}));

vi.mock('@/stores/logStore', () => ({
  logStore: {
    error: (message: string, details?: string) =>
      mockLogError(message, details),
    warn: (message: string, details?: string) => mockLogWarn(message, details)
  }
}));

describe('usePhotosActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadFile.mockResolvedValue({ id: 'upload-1' });
    mockShareFile.mockResolvedValue(true);
    mockCanShareFiles.mockReturnValue(true);
  });

  it('returns upload id from file upload helper', async () => {
    const { result } = renderHook(() => usePhotosActions());
    const onProgress = vi.fn();
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });

    const uploadId = await result.current.uploadFile(file, onProgress);

    expect(uploadId).toBe('upload-1');
    expect(mockUploadFile).toHaveBeenCalledWith(file, onProgress);
  });

  it('delegates file actions, window actions, and logging', async () => {
    const { result } = renderHook(() => usePhotosActions());
    const data = new Uint8Array([1, 2, 3]);

    result.current.handleDownloadFile(data, 'a.jpg');
    await result.current.handleShareFile(data, 'a.jpg', 'image/jpeg');
    result.current.handleOpenWindow('photos');
    result.current.handleRequestWindowOpen('chat', { from: 'photos' });
    result.current.handleSetAttachedImage('data:image/jpeg;base64,abc');
    result.current.logError('oops', 'details');
    result.current.logWarn('warn', 'details');

    expect(result.current.canShareFiles()).toBe(true);
    expect(mockDownloadFile).toHaveBeenCalledWith(data, 'a.jpg');
    expect(mockShareFile).toHaveBeenCalledWith(data, 'a.jpg', 'image/jpeg');
    expect(mockOpenWindow).toHaveBeenCalledWith('photos');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('chat', {
      from: 'photos'
    });
    expect(mockSetAttachedImage).toHaveBeenCalledWith(
      'data:image/jpeg;base64,abc'
    );
    expect(mockLogError).toHaveBeenCalledWith('oops', 'details');
    expect(mockLogWarn).toHaveBeenCalledWith('warn', 'details');
  });
});
