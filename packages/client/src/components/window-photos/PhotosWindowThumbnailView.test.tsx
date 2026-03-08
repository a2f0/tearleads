import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PhotosWindowThumbnailView } from './PhotosWindowThumbnailView';

vi.mock('@/pages/photos-components', () => ({
  Photos: ({
    onSelectPhoto
  }: {
    onSelectPhoto?: (photoId: string) => void;
  }) => (
    <button
      type="button"
      data-testid="photos-mock"
      onClick={() => onSelectPhoto?.('photo-1')}
    >
      Photos Mock
    </button>
  )
}));

describe('PhotosWindowThumbnailView', () => {
  it('renders Photos component', async () => {
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

  it('renders without error when inside a router context (WindowRenderer is inside BrowserRouter)', () => {
    expect(() =>
      render(
        <MemoryRouter>
          <PhotosWindowThumbnailView refreshToken={0} />
        </MemoryRouter>
      )
    ).not.toThrow();
    expect(screen.getByTestId('photos-mock')).toBeInTheDocument();
  });
});
