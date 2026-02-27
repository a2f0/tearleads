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

    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      value: HTMLMediaElement.HAVE_METADATA
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 1280
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 720
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

  it('starts camera stream, captures, reviews, and accepts a frame', async () => {
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
    fireEvent.loadedMetadata(screen.getByTestId('camera-video'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Capture' })).toBeEnabled();
    });

    // Capture shows review screen
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));

    // Review screen should appear
    expect(await screen.findByTestId('camera-review')).toBeInTheDocument();
    expect(
      screen.getByAltText('Captured frame for review')
    ).toBeInTheDocument();

    // Accept the capture
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    // Should return to capture mode and show the capture in the list
    expect(await screen.findByAltText('Capture 1')).toBeInTheDocument();
  });

  it('allows retaking a capture from review screen', async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }]
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    setMockMediaDevices(getUserMedia);

    render(<CameraCapture />);

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });
    fireEvent.loadedMetadata(screen.getByTestId('camera-video'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Capture' })).toBeEnabled();
    });

    // Capture shows review screen
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    expect(await screen.findByTestId('camera-review')).toBeInTheDocument();

    // Retake should go back to capture mode without saving
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));

    // Should be back on capture screen without any captures
    expect(await screen.findByTestId('camera-capture')).toBeInTheDocument();
    expect(screen.queryByAltText('Capture 1')).not.toBeInTheDocument();
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
