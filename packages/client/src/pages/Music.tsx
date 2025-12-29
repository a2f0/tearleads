import { Database, Loader2, Music, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDatabaseAdapter } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { formatFileSize } from '@/lib/utils';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

interface AudioInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
}

interface AudioWithUrl extends AudioInfo {
  objectUrl: string;
}

export function MusicPage() {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [tracks, setTracks] = useState<AudioWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchTracks = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const adapter = getDatabaseAdapter();

      const result = await adapter.execute(
        `SELECT id, name, size, mime_type, upload_date, storage_path
         FROM files
         WHERE mime_type LIKE 'audio/%' AND deleted = 0
         ORDER BY upload_date DESC`,
        []
      );

      const trackList: AudioInfo[] = result.rows.map((row) => {
        const r = row as {
          id: string;
          name: string;
          size: number;
          mime_type: string;
          upload_date: number;
          storage_path: string;
        };
        return {
          id: r.id,
          name: r.name,
          size: r.size,
          mimeType: r.mime_type,
          uploadDate: new Date(r.upload_date),
          storagePath: r.storage_path
        };
      });

      // Load audio data and create object URLs
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey);
      }

      const storage = getFileStorage();
      const tracksWithUrls = (
        await Promise.all(
          trackList.map(async (track) => {
            try {
              const data = await storage.retrieve(track.storagePath);
              const buffer = new ArrayBuffer(data.byteLength);
              new Uint8Array(buffer).set(data);
              const blob = new Blob([buffer], { type: track.mimeType });
              const objectUrl = URL.createObjectURL(blob);
              return { ...track, objectUrl };
            } catch (err) {
              console.error(`Failed to load track ${track.name}:`, err);
              return null;
            }
          })
        )
      ).filter((t): t is AudioWithUrl => t !== null);

      setTracks(tracksWithUrls);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch tracks:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked && !hasFetched && !loading) {
      fetchTracks();
    }
  }, [isUnlocked, hasFetched, loading, fetchTracks]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      for (const t of tracks) {
        URL.revokeObjectURL(t.objectUrl);
      }
    };
  }, [tracks]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Music className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Music</h1>
        </div>
        {isUnlocked && (
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTracks}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="rounded-lg border p-8 text-center">
          <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Database is locked. Unlock it from the SQLite page to view music.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading music...
          </div>
        ) : tracks.length === 0 && hasFetched ? (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            No music found. Upload audio files from the Files page to see them
            here.
          </div>
        ) : (
          <div className="space-y-2">
            {tracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-4 rounded-lg border p-4"
              >
                <Music className="h-8 w-8 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{track.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {formatFileSize(track.size)}
                  </p>
                </div>
                {/* biome-ignore lint/a11y/useMediaCaption: Music files typically don't have caption tracks */}
                <audio controls className="h-8 w-48 shrink-0">
                  <source src={track.objectUrl} type={track.mimeType} />
                  Your browser does not support the audio element.
                </audio>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
