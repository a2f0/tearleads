interface UploadProgressProps {
  progress: number;
  label?: string;
}

export function UploadProgress({
  progress,
  label = 'Upload progress'
}: UploadProgressProps) {
  const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="w-full max-w-sm">
      <div className="mb-2 flex items-center justify-between text-muted-foreground text-xs">
        <span>{label}</span>
        <span>{clampedProgress}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedProgress}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
    </div>
  );
}
