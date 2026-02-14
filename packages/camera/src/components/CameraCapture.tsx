import { Camera, CameraOff, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type CameraStatus = 'idle' | 'starting' | 'ready' | 'blocked' | 'error';

const PERMISSION_DENIED_ERROR = 'NotAllowedError';

export interface CameraCaptureProps {
  maxCaptures?: number | undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === PERMISSION_DENIED_ERROR) {
    return 'Camera permission was denied. Enable camera access and try again.';
  }

  return 'Unable to access the camera. Check device permissions and availability.';
}

export function CameraCapture({ maxCaptures = 20 }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureIdRef = useRef(0);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [captures, setCaptures] = useState<
    Array<{ id: string; dataUrl: string }>
  >([]);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(
    'environment'
  );

  const stopCamera = useCallback(() => {
    const current = streamRef.current;
    if (!current) {
      return;
    }

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
        video: {
          facingMode
        }
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
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

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setErrorMessage('Camera stream is not ready. Try again in a moment.');
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      setErrorMessage('Unable to initialize capture canvas.');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const captureData = canvas.toDataURL('image/jpeg', 0.92);

    const captureId = `capture-${Date.now()}-${captureIdRef.current}`;
    captureIdRef.current += 1;
    setCaptures((previous) =>
      [{ id: captureId, dataUrl: captureData }, ...previous].slice(
        0,
        maxCaptures
      )
    );
    setErrorMessage(null);
  }, [maxCaptures]);

  const handleClearCaptures = useCallback(() => {
    setCaptures([]);
  }, []);

  const handleToggleCamera = useCallback(() => {
    setFacingMode((previous) =>
      previous === 'environment' ? 'user' : 'environment'
    );
  }, []);

  const canCapture = status === 'ready';
  const hasCaptures = captures.length > 0;

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3"
      data-testid="camera-capture"
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-contain"
          data-testid="camera-video"
        />
        {!canCapture && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4 text-center text-sm text-white">
            <CameraOff className="h-8 w-8" />
            <span>
              {status === 'starting'
                ? 'Starting camera...'
                : (errorMessage ?? 'Camera is unavailable.')}
            </span>
          </div>
        )}
      </div>

      {errorMessage && status !== 'starting' && (
        <p
          className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          role="alert"
        >
          {errorMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCapture}
          disabled={!canCapture}
          className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Camera className="h-4 w-4" />
          Capture
        </button>
        <button
          type="button"
          onClick={() => void startCamera()}
          disabled={status === 'starting'}
          className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          Restart Camera
        </button>
        <button
          type="button"
          onClick={handleToggleCamera}
          disabled={status === 'starting'}
          className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCcw className="h-4 w-4" />
          Switch Camera
        </button>
        <button
          type="button"
          onClick={handleClearCaptures}
          disabled={!hasCaptures}
          className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          Clear Captures
        </button>
      </div>

      <div className="grid max-h-44 grid-cols-4 gap-2 overflow-y-auto rounded border p-2">
        {captures.length === 0 && (
          <p className="col-span-full text-muted-foreground text-xs">
            Captures appear here. This list is ready for a multi-page scanner
            flow in the next iteration.
          </p>
        )}
        {captures.map((capture, index) => (
          <img
            key={capture.id}
            src={capture.dataUrl}
            alt={`Capture ${index + 1}`}
            className="h-20 w-full rounded border object-cover"
          />
        ))}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </section>
  );
}
