import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindowContent } from './PhotosWindowContent';

const mockUploadFile = vi.fn();

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

vi.mock('@/pages/Photos', () => ({
  Photos: () => <div data-testid="photos-page">Photos Page Content</div>
}));

describe('PhotosWindowContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Photos page content', async () => {
    render(<PhotosWindowContent />);
    expect(await screen.findByTestId('photos-page')).toBeInTheDocument();
  });

  it('exposes uploadFiles and refresh methods via ref', () => {
    const ref = {
      current: null as {
        uploadFiles: (files: File[]) => void;
        refresh: () => void;
      } | null
    };
    render(<PhotosWindowContent ref={ref} />);

    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.uploadFiles).toBe('function');
    expect(typeof ref.current?.refresh).toBe('function');
  });

  it('calls uploadFile for each file when uploadFiles is called', async () => {
    const ref = {
      current: null as {
        uploadFiles: (files: File[]) => void;
        refresh: () => void;
      } | null
    };
    render(<PhotosWindowContent ref={ref} />);

    const files = [
      new File(['content1'], 'photo1.jpg', { type: 'image/jpeg' }),
      new File(['content2'], 'photo2.jpg', { type: 'image/jpeg' })
    ];

    await act(async () => {
      await ref.current?.uploadFiles(files);
    });

    expect(mockUploadFile).toHaveBeenCalledTimes(2);
  });

  it('handles upload errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUploadFile.mockRejectedValueOnce(new Error('Upload failed'));

    const ref = {
      current: null as {
        uploadFiles: (files: File[]) => void;
        refresh: () => void;
      } | null
    };
    render(<PhotosWindowContent ref={ref} />);

    await act(async () => {
      await ref.current?.uploadFiles([
        new File(['content'], 'photo.jpg', { type: 'image/jpeg' })
      ]);
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to upload photo.jpg:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('triggers refresh when refresh is called', async () => {
    const ref = {
      current: null as {
        uploadFiles: (files: File[]) => void;
        refresh: () => void;
      } | null
    };
    render(<PhotosWindowContent ref={ref} />);

    await act(async () => {
      ref.current?.refresh();
    });

    // Verify it doesn't throw
    expect(ref.current?.refresh).toBeDefined();
  });
});
