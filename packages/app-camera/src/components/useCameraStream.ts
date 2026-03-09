import { useCallback, useEffect, useRef, useState } from 'react';

type CameraStatus = 'idle' | 'starting' | 'ready' | 'blocked' | 'error';

const PERMISSION_DENIED_ERROR = 'NotAllowedError';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === PERMISSION_DENIED_ERROR) {
    return 'Camera permission was denied. Enable camera access and try again.';
  }

  return 'Unable to access the camera. Check device permissions and availability.';
}

interface UseCameraStreamResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  status: CameraStatus;
  errorMessage: string | null;
  startCamera: () => Promise<void>;
  captureFrame: () => string | null;
}

export function useCameraStream(
  facingMode: 'user' | 'environment'
): UseCameraStreamResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    const current = streamRef.current;
    if (!current) return;

    for (const track of current.getTracks()) {
      track.stop();
    }

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setErrorMessage('Camera access is not supported in this browser.');
      return;
    }

    stopCamera();
    setStatus('starting');
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode }
      });

      streamRef.current = stream;

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;

        await new Promise<void>((resolve) => {
          const handleLoaded = () => {
            video.removeEventListener('loadedmetadata', handleLoaded);
            resolve();
          };
          if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
            resolve();
          } else {
            video.addEventListener('loadedmetadata', handleLoaded);
          }
        });

        await video.play();
      }

      setStatus('ready');
    } catch (error) {
      stopCamera();
      setStatus(
        error instanceof Error && error.name === PERMISSION_DENIED_ERROR
          ? 'blocked'
          : 'error'
      );
      setErrorMessage(getErrorMessage(error));
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setErrorMessage('Camera stream is not ready. Try again in a moment.');
      return null;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      setErrorMessage('Unable to initialize capture canvas.');
      return null;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setErrorMessage(null);

    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  return {
    videoRef,
    canvasRef,
    status,
    errorMessage,
    startCamera,
    captureFrame
  };
}
