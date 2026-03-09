import { Camera, RotateCcw, Trash2 } from 'lucide-react';

interface CameraCaptureControlsProps {
  canCapture: boolean;
  isStarting: boolean;
  hasNewCaptures: boolean;
  onCapture: () => void;
  onRestart: () => void;
  onToggleCamera: () => void;
  onClearCaptures: () => void;
}

export function CameraCaptureControls({
  canCapture,
  isStarting,
  hasNewCaptures,
  onCapture,
  onRestart,
  onToggleCamera,
  onClearCaptures
}: CameraCaptureControlsProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onCapture}
        disabled={!canCapture}
        className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Camera className="h-4 w-4" />
        Capture
      </button>
      <button
        type="button"
        onClick={onRestart}
        disabled={isStarting}
        className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        Restart Camera
      </button>
      <button
        type="button"
        onClick={onToggleCamera}
        disabled={isStarting}
        className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RotateCcw className="h-4 w-4" />
        Switch Camera
      </button>
      <button
        type="button"
        onClick={onClearCaptures}
        disabled={!hasNewCaptures}
        className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Trash2 className="h-4 w-4" />
        Clear Captures
      </button>
    </div>
  );
}
