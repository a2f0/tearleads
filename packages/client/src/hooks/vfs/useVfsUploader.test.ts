import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVfsUploader } from './useVfsUploader';

const mockUploadFile = vi.fn();
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    db: {
      select: mockDbSelect,
      insert: mockDbInsert
    }
  })
}));

vi.mock('./useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

describe('useVfsUploader', () => {
  beforeEach(() => {
    mockUploadFile.mockReset();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();

    // Default mock: no existing link
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });

    const mockValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: mockValues });
  });

  it('returns required properties', () => {
    const { result } = renderHook(() => useVfsUploader());

    expect(result.current.fileInputRef).toBeDefined();
    expect(result.current.refreshToken).toBe(0);
    expect(typeof result.current.handleUpload).toBe('function');
    expect(typeof result.current.handleFileInputChange).toBe('function');
  });

  it('handleUpload stores folder ID and triggers file input click', () => {
    const { result } = renderHook(() => useVfsUploader());

    const mockFileInput = { click: vi.fn() };
    (result.current.fileInputRef as { current: unknown }).current =
      mockFileInput;

    act(() => {
      result.current.handleUpload('folder-123');
    });

    expect(mockFileInput.click).toHaveBeenCalled();
  });

  it('handleFileInputChange uploads file and creates VFS link', async () => {
    mockUploadFile.mockResolvedValue({ id: 'uploaded-file-id' });

    const { result } = renderHook(() => useVfsUploader());

    // First set up folder ID via handleUpload
    const mockFileInput = { click: vi.fn() };
    (result.current.fileInputRef as { current: unknown }).current =
      mockFileInput;

    act(() => {
      result.current.handleUpload('target-folder-id');
    });

    // Simulate file input change
    const mockEvent = {
      target: {
        files: [new File(['test'], 'test.txt', { type: 'text/plain' })],
        value: 'test.txt'
      }
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileInputChange(mockEvent);
    });

    expect(mockUploadFile).toHaveBeenCalled();
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it('does not create duplicate link if link already exists', async () => {
    mockUploadFile.mockResolvedValue({ id: 'uploaded-file-id' });

    // Mock existing link
    const mockWhere = vi.fn().mockResolvedValue([{ id: 'existing-link' }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });

    const { result } = renderHook(() => useVfsUploader());

    const mockFileInput = { click: vi.fn() };
    (result.current.fileInputRef as { current: unknown }).current =
      mockFileInput;

    act(() => {
      result.current.handleUpload('target-folder-id');
    });

    const mockEvent = {
      target: {
        files: [new File(['test'], 'test.txt', { type: 'text/plain' })],
        value: 'test.txt'
      }
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileInputChange(mockEvent);
    });

    expect(mockUploadFile).toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('increments refreshToken after upload', async () => {
    mockUploadFile.mockResolvedValue({ id: 'uploaded-file-id' });

    const { result } = renderHook(() => useVfsUploader());

    const mockFileInput = { click: vi.fn() };
    (result.current.fileInputRef as { current: unknown }).current =
      mockFileInput;

    act(() => {
      result.current.handleUpload('target-folder-id');
    });

    const initialToken = result.current.refreshToken;

    const mockEvent = {
      target: {
        files: [new File(['test'], 'test.txt', { type: 'text/plain' })],
        value: 'test.txt'
      }
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileInputChange(mockEvent);
    });

    expect(result.current.refreshToken).toBe(initialToken + 1);
  });
});
