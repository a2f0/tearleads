import { Check, RotateCcw } from 'lucide-react';

interface CameraReviewProps {
  capture: { id: string; dataUrl: string };
  onRetake: () => void;
  onAccept: () => void;
}

export function CameraReview({
  capture,
  onRetake,
  onAccept
}: CameraReviewProps) {
  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3"
      data-testid="camera-review"
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-black">
        <img
          src={capture.dataUrl}
          alt="Captured frame for review"
          className="h-full w-full object-contain"
          data-testid="camera-review-image"
        />
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={onRetake}
          className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm hover:bg-muted"
          data-testid="camera-review-retake"
        >
          <RotateCcw className="h-4 w-4" />
          Retake
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="inline-flex items-center gap-2 rounded border border-primary bg-primary px-4 py-2 text-primary-foreground text-sm hover:bg-primary/90"
          data-testid="camera-review-accept"
        >
          <Check className="h-4 w-4" />
          Accept
        </button>
      </div>
    </section>
  );
}
