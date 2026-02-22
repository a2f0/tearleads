import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropZoneOverlayProps {
  /** Whether the overlay should be visible */
  isVisible: boolean;
  /** Label for the file type (e.g., "photos", "videos", "documents") */
  label: string;
  /** Optional custom message */
  message?: string;
  /** Optional className for styling */
  className?: string;
}

/**
 * Overlay component shown when files are being dragged over a drop zone.
 * Should be placed inside a relative-positioned container.
 */
export function DropZoneOverlay({
  isVisible,
  label,
  message,
  className
}: DropZoneOverlayProps) {
  if (!isVisible) {
    return null;
  }

  const displayMessage = message ?? `Drop ${label} here`;

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-primary/10 ring-2 ring-primary ring-inset transition-opacity',
        className
      )}
      data-testid="drop-zone-overlay"
    >
      <Upload className="h-10 w-10 text-primary" />
      <p className="font-medium text-primary text-sm">{displayMessage}</p>
    </div>
  );
}
