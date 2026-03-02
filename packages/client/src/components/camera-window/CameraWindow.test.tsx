import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tearleads/camera', () => ({
  CameraWindow: ({
    id,
    initialPhotos
  }: {
    id: string;
    initialPhotos?: unknown[];
  }) => (
    <div
      data-testid="camera-window-base"
      data-id={id}
      data-initial-photos={JSON.stringify(initialPhotos ?? [])}
    />
  )
}));

vi.mock('./useCameraPhotoRoll', () => ({
  useCameraPhotoRoll: () => ({
    photos: [{ id: 'roll-1', thumbnailUrl: 'blob:roll-1' }],
    loading: false
  })
}));

vi.mock('../photos-window/usePhotoAlbums', () => ({
  usePhotoAlbums: () => ({
    getPhotoRollAlbum: () => ({ id: 'photo-roll-id' }),
    addPhotoToAlbum: vi.fn()
  })
}));

vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: vi.fn().mockResolvedValue({ id: 'file-id' })
  })
}));

import { CameraWindow } from './index';

describe('CameraWindow', () => {
  it('renders CameraWindow from @tearleads/camera', () => {
    render(
      <CameraWindow
        id="camera-window-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    expect(screen.getByTestId('camera-window-base')).toBeInTheDocument();
    expect(screen.getByTestId('camera-window-base')).toHaveAttribute(
      'data-id',
      'camera-window-1'
    );
  });

  it('passes photo roll photos as initialPhotos', () => {
    render(
      <CameraWindow
        id="camera-window-2"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    const element = screen.getByTestId('camera-window-base');
    const initialPhotos = JSON.parse(
      element.getAttribute('data-initial-photos') ?? '[]'
    );
    expect(initialPhotos).toEqual([
      { id: 'roll-1', thumbnailUrl: 'blob:roll-1' }
    ]);
  });
});
