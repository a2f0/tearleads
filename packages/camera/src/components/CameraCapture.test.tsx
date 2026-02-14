import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraCapture } from './CameraCapture';

function setMockMediaDevices(
  getUserMedia: (typeof navigator.mediaDevices)['getUserMedia']
) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia
    }
  });
}

describe('CameraCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      writable: true,
      value: null
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined)
    });

    const mockContext = {
      drawImage: vi.fn()
    } as unknown as CanvasRenderingContext2D;

    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn().mockReturnValue(mockContext)
    });

    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      value: vi.fn().mockReturnValue('data:image/jpeg;base64,capture-1')
    });
  });

  it('starts camera stream and captures a frame', async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }]
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    setMockMediaDevices(getUserMedia);

    render(<CameraCapture />);

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: false,
        video: { facingMode: 'environment' }
      });
    });

    const video = screen.getByTestId('camera-video');
    Object.defineProperty(video, 'videoWidth', {
      configurable: true,
      value: 1280
    });
    Object.defineProperty(video, 'videoHeight', {
      configurable: true,
      value: 720
    });

    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(await screen.findByAltText('Capture 1')).toBeInTheDocument();
  });

  it('shows a permission message when camera access is denied', async () => {
    const deniedError = Object.assign(new Error('denied'), {
      name: 'NotAllowedError'
    });
    const getUserMedia = vi.fn().mockRejectedValue(deniedError);
    setMockMediaDevices(getUserMedia);

    render(<CameraCapture />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Camera permission was denied. Enable camera access and try again.'
    );
  });

  it('stops media tracks when unmounted', async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }]
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    setMockMediaDevices(getUserMedia);

    const { unmount } = render(<CameraCapture />);

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});
