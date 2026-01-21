import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhotosWindowThumbnailView } from './PhotosWindowThumbnailView';

vi.mock('@/pages/Photos', async () => {
  const { useNavigate } = await import('react-router-dom');
  return {
    Photos: ({
      onSelectPhoto
    }: {
      onSelectPhoto?: (photoId: string) => void;
    }) => {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          data-testid="photos-mock"
          onClick={() => {
            onSelectPhoto?.('photo-1');
            navigate('/photos');
          }}
        >
          Photos Mock
        </button>
      );
    }
  };
});

describe('PhotosWindowThumbnailView', () => {
  it('renders Photos with router context', async () => {
    const user = userEvent.setup();
    const onSelectPhoto = vi.fn();
    render(
      <PhotosWindowThumbnailView
        refreshToken={0}
        onSelectPhoto={onSelectPhoto}
      />
    );

    await user.click(screen.getByTestId('photos-mock'));

    expect(onSelectPhoto).toHaveBeenCalledWith('photo-1');
  });
});
