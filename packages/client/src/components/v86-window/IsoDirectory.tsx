import { AlertCircle, Database } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Dropzone } from '@/components/ui/dropzone';
import { formatBytes } from '@/lib/v86/format-bytes';
import { ISO_CATALOG } from '@/lib/v86/iso-catalog';
import {
  getStorageUsage,
  isOpfsSupported,
  listDownloadedIsos
} from '@/lib/v86/iso-storage';
import type { IsoCatalogEntry, StoredIso } from '@/lib/v86/types';
import { IsoDirectoryItem } from './IsoDirectoryItem';

interface IsoDirectoryProps {
  onSelectIso: (entry: IsoCatalogEntry) => void;
  showDropzone: boolean;
  onUploadFiles: (files: File[]) => void;
  refreshToken: number;
}

const DEFAULT_UPLOAD_MEMORY_MB = 256;

export function IsoDirectory({
  onSelectIso,
  showDropzone,
  onUploadFiles,
  refreshToken
}: IsoDirectoryProps) {
  const [downloadedIsos, setDownloadedIsos] = useState<StoredIso[]>([]);
  const [storageUsage, setStorageUsage] = useState<{
    used: number;
    available: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isOpfsSupported()) return;

    try {
      const [isos, usage] = await Promise.all([
        listDownloadedIsos(),
        getStorageUsage()
      ]);
      setDownloadedIsos(isos);
      setStorageUsage(usage);
    } catch (err) {
      console.error('Failed to load ISO directory:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken intentionally triggers refresh on change
  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  if (!isOpfsSupported()) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <div>
          <h3 className="font-medium">Browser Not Supported</h3>
          <p className="mt-1 text-muted-foreground text-sm">
            Your browser does not support the Origin Private File System (OPFS)
            required for storing ISO images.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const catalogIds = new Set(ISO_CATALOG.map((entry) => entry.id));
  const downloadedIds = new Set(downloadedIsos.map((iso) => iso.id));
  const uploadedIsos = downloadedIsos.filter((iso) => !catalogIds.has(iso.id));
  const uploadedEntries: IsoCatalogEntry[] = uploadedIsos.map((iso) => ({
    id: iso.id,
    name: iso.name,
    description: 'Uploaded ISO',
    downloadUrl: '',
    sizeBytes: iso.sizeBytes,
    bootType: 'cdrom',
    memoryMb: DEFAULT_UPLOAD_MEMORY_MB
  }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">ISO Directory</span>
        </div>
        {storageUsage && (
          <span className="text-muted-foreground text-xs">
            {formatBytes(storageUsage.used)} used /{' '}
            {formatBytes(storageUsage.available)} available
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {showDropzone && (
          <div className="mb-4">
            <Dropzone
              onFilesSelected={onUploadFiles}
              accept=".iso,application/x-iso9660-image"
              label="ISO images"
            />
          </div>
        )}

        {uploadedEntries.length > 0 && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Uploaded ISOs
            </p>
            <div className="grid gap-3">
              {uploadedEntries.map((entry) => (
                <IsoDirectoryItem
                  key={entry.id}
                  entry={entry}
                  isDownloaded={true}
                  onBoot={onSelectIso}
                  onRefresh={refresh}
                />
              ))}
            </div>
          </div>
        )}

        <div
          className={`grid gap-3 ${uploadedEntries.length > 0 || showDropzone ? 'mt-4' : ''}`}
        >
          {ISO_CATALOG.map((entry) => (
            <IsoDirectoryItem
              key={entry.id}
              entry={entry}
              isDownloaded={downloadedIds.has(entry.id)}
              onBoot={onSelectIso}
              onRefresh={refresh}
            />
          ))}
        </div>

        {ISO_CATALOG.length === 0 && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No ISOs available in catalog
          </div>
        )}
      </div>
    </div>
  );
}
