import { Download, HardDrive, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/v86/format-bytes';
import { deleteIso, downloadIso } from '@/lib/v86/iso-storage';
import type { DownloadProgress, IsoCatalogEntry } from '@/lib/v86/types';

interface IsoDirectoryItemProps {
  entry: IsoCatalogEntry;
  isDownloaded: boolean;
  onBoot: (entry: IsoCatalogEntry) => void;
  onRefresh: () => void;
}

export function IsoDirectoryItem({
  entry,
  isDownloaded,
  onBoot,
  onRefresh
}: IsoDirectoryItemProps) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    setProgress({ loaded: 0, total: entry.sizeBytes, percentage: 0 });

    try {
      await downloadIso(entry, setProgress);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteIso(entry.id);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{entry.name}</span>
            {isDownloaded && (
              <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-green-600 text-xs dark:text-green-400">
                Downloaded
              </span>
            )}
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            {entry.description}
          </p>
          <div className="mt-1 flex gap-3 text-muted-foreground text-xs">
            <span>{formatBytes(entry.sizeBytes)}</span>
            <span>{entry.memoryMb} MB RAM</span>
            <span>Boot: {entry.bootType}</span>
          </div>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {downloading && progress && (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {formatBytes(progress.loaded)} / {formatBytes(progress.total)} (
            {progress.percentage}%)
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {isDownloaded ? (
          <>
            <Button size="sm" onClick={() => onBoot(entry)} className="flex-1">
              <Play className="mr-1 h-3 w-3" />
              Boot
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1"
          >
            <Download className="mr-1 h-3 w-3" />
            {downloading ? 'Downloading...' : 'Download'}
          </Button>
        )}
      </div>
    </div>
  );
}
