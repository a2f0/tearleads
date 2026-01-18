import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindowTableView } from './PhotosWindowTableView';

const mockUsePhotosWindowData = vi.fn();

vi.mock('./usePhotosWindowData', () => ({
  usePhotosWindowData: () => mockUsePhotosWindowData()
}));

describe('PhotosWindowTableView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no photos are available', () => {
    mockUsePhotosWindowData.mockReturnValue({
      photos: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: 'instance-1'
    });

    render(<PhotosWindowTableView refreshToken={0} />);

    expect(
      screen.getByText('No photos yet. Use Upload to add images.')
    ).toBeInTheDocument();
  });

  it('calls onSelectPhoto when a row is clicked', () => {
    const onSelectPhoto = vi.fn();
    mockUsePhotosWindowData.mockReturnValue({
      photos: [
        {
          id: 'photo-1',
          name: 'photo.jpg',
          size: 1200,
          mimeType: 'image/jpeg',
          uploadDate: new Date('2024-01-01T00:00:00Z'),
          storagePath: '/photos/photo.jpg',
          thumbnailPath: null,
          objectUrl: 'blob:photo'
        }
      ],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: 'instance-1'
    });

    render(
      <PhotosWindowTableView refreshToken={0} onSelectPhoto={onSelectPhoto} />
    );

    const row = screen.getByText('photo.jpg');
    fireEvent.click(row);

    expect(onSelectPhoto).toHaveBeenCalledWith('photo-1');
  });
});
