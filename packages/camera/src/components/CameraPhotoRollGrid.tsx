interface CaptureEntry {
  id: string;
  thumbnailUrl: string;
}

interface CameraPhotoRollGridProps {
  captures: CaptureEntry[];
}

export function CameraPhotoRollGrid({ captures }: CameraPhotoRollGridProps) {
  return (
    <div className="grid max-h-44 shrink-0 grid-cols-4 gap-2 overflow-y-auto rounded border p-2">
      {captures.length === 0 && (
        <p className="col-span-full text-muted-foreground text-xs">
          Captures appear here. This list is ready for a multi-page scanner flow
          in the next iteration.
        </p>
      )}
      {captures.map((capture, index) => (
        <img
          key={capture.id}
          src={capture.thumbnailUrl}
          alt={`Capture ${index + 1}`}
          className="h-20 w-full rounded border object-cover"
        />
      ))}
    </div>
  );
}
