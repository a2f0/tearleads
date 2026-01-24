import { ArrowLeft, Power, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getIsoUrl } from '@/lib/v86/iso-storage';
import type { IsoCatalogEntry } from '@/lib/v86/types';
import { useV86 } from './useV86';

interface V86EmulatorProps {
  iso: IsoCatalogEntry;
  onBack: () => void;
}

export function V86Emulator({ iso, onBack }: V86EmulatorProps) {
  const [isoUrl, setIsoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let url: string | null = null;

    async function loadIso() {
      try {
        url = await getIsoUrl(iso.id);
        if (mounted) {
          setIsoUrl(url);
        }
      } catch (err) {
        if (mounted) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load ISO'
          );
        }
      }
    }

    void loadIso();

    return () => {
      mounted = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [iso.id]);

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
        <p className="text-destructive">{loadError}</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to ISO Directory
        </Button>
      </div>
    );
  }

  if (!isoUrl) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading ISO...</p>
      </div>
    );
  }

  return <V86EmulatorInner iso={iso} isoUrl={isoUrl} onBack={onBack} />;
}

interface V86EmulatorInnerProps {
  iso: IsoCatalogEntry;
  isoUrl: string;
  onBack: () => void;
}

function V86EmulatorInner({ iso, isoUrl, onBack }: V86EmulatorInnerProps) {
  const { containerRef, status, error, start, stop, restart } = useV86({
    iso,
    isoUrl
  });

  useEffect(() => {
    start();
  }, [start]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-2 py-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-3 w-3" />
          Back
        </Button>
        <div className="flex-1" />
        <span className="text-muted-foreground text-xs">
          {iso.name} - {status}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={restart}
          disabled={status !== 'running' && status !== 'stopped'}
          title="Restart"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={status === 'running' ? stop : start}
          title={status === 'running' ? 'Power Off' : 'Power On'}
        >
          <Power className="h-3 w-3" />
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 px-4 py-2 text-destructive text-sm">
          {error}
        </div>
      )}

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden bg-black"
        style={{ minHeight: 400 }}
      >
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white">Starting emulator...</p>
          </div>
        )}
      </div>
    </div>
  );
}
