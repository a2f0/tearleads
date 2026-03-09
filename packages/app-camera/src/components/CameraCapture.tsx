import { CameraOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraCaptureControls } from './CameraCaptureControls';
import { CameraPhotoRollGrid } from './CameraPhotoRollGrid';
import { CameraReview } from './CameraReview';
import { useCameraStream } from './useCameraStream';

export interface CameraPhotoRollItem {
  id: string;
  thumbnailUrl: string;
}

interface CaptureEntry {
  id: string;
  thumbnailUrl: string;
  isNew: boolean;
}

export interface CameraCaptureProps {
  maxCaptures?: number | undefined;
  onPhotoAccepted?: ((dataUrl: string) => void) | undefined;
  initialPhotos?: CameraPhotoRollItem[] | undefined;
}

export function CameraCapture({
  maxCaptures = 20,
  onPhotoAccepted,
  initialPhotos
}: CameraCaptureProps) {
  const captureIdRef = useRef(0);
  const seededRef = useRef(false);
  const [captures, setCaptures] = useState<CaptureEntry[]>([]);
  const [reviewingCapture, setReviewingCapture] = useState<{
    id: string;
    dataUrl: string;
  } | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(
    'environment'
  );

  const {
    videoRef,
    canvasRef,
    status,
    errorMessage,
    startCamera,
    captureFrame
  } = useCameraStream(facingMode);

  useEffect(() => {
    if (seededRef.current || !initialPhotos || initialPhotos.length === 0) {
      return;
    }
    seededRef.current = true;
    setCaptures((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const newEntries = initialPhotos
        .filter((p) => !existingIds.has(p.id))
        .map((p) => ({ id: p.id, thumbnailUrl: p.thumbnailUrl, isNew: false }));
      return [...prev, ...newEntries];
    });
  }, [initialPhotos]);

  const handleCapture = useCallback(() => {
    const dataUrl = captureFrame();
    if (!dataUrl) return;

    const captureId = `capture-${Date.now()}-${captureIdRef.current}`;
    captureIdRef.current += 1;

    setReviewingCapture({ id: captureId, dataUrl });
  }, [captureFrame]);

  const handleRetake = useCallback(() => {
    setReviewingCapture(null);
  }, []);

  const handleAccept = useCallback(() => {
    if (reviewingCapture) {
      setCaptures((previous) =>
        [
          {
            id: reviewingCapture.id,
            thumbnailUrl: reviewingCapture.dataUrl,
            isNew: true
          },
          ...previous
        ].slice(0, maxCaptures)
      );
      onPhotoAccepted?.(reviewingCapture.dataUrl);
    }
    setReviewingCapture(null);
  }, [reviewingCapture, maxCaptures, onPhotoAccepted]);

  const handleClearCaptures = useCallback(() => {
    setCaptures((prev) => prev.filter((c) => !c.isNew));
  }, []);

  const handleToggleCamera = useCallback(() => {
    setFacingMode((previous) =>
      previous === 'environment' ? 'user' : 'environment'
    );
  }, []);

  const canCapture = status === 'ready';
  const hasNewCaptures = captures.some((c) => c.isNew);

  if (reviewingCapture) {
    return (
      <CameraReview
        capture={reviewingCapture}
        onRetake={handleRetake}
        onAccept={handleAccept}
      />
    );
  }

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

      <CameraCaptureControls
        canCapture={canCapture}
        isStarting={status === 'starting'}
        hasNewCaptures={hasNewCaptures}
        onCapture={handleCapture}
        onRestart={() => void startCamera()}
        onToggleCamera={handleToggleCamera}
        onClearCaptures={handleClearCaptures}
      />

      <CameraPhotoRollGrid captures={captures} />

      <canvas ref={canvasRef} className="hidden" />
    </section>
  );
}
