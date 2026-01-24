import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  EmulatorStatus,
  IsoCatalogEntry,
  V86Emulator
} from '@/lib/v86/types';

declare global {
  interface Window {
    V86: new (options: V86Options) => V86Emulator;
  }
}

interface V86Options {
  wasm_path: string;
  bios: { url: string };
  vga_bios: { url: string };
  cdrom?: { url: string };
  hda?: { url: string; async?: boolean; size?: number };
  memory_size: number;
  vga_memory_size: number;
  screen_container: HTMLElement;
  autostart?: boolean;
}

interface UseV86Options {
  iso: IsoCatalogEntry;
  isoUrl: string;
}

interface UseV86Return {
  containerRef: React.RefObject<HTMLDivElement | null>;
  status: EmulatorStatus;
  error: string | null;
  start: () => void;
  stop: () => void;
  restart: () => void;
}

const V86_BASE_URL = '/v86/';

let libv86Loaded = false;
let loadPromise: Promise<void> | null = null;

async function loadLibV86(): Promise<void> {
  if (libv86Loaded) return;

  // Prevent race condition by reusing the same promise if already loading
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${V86_BASE_URL}libv86.js`;
    script.async = true;
    script.onload = () => {
      libv86Loaded = true;
      resolve();
    };
    script.onerror = () => {
      loadPromise = null; // Allow retrying on failure
      reject(new Error('Failed to load libv86.js'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function useV86({ iso, isoUrl }: UseV86Options): UseV86Return {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const emulatorRef = useRef<V86Emulator | null>(null);
  const [status, setStatus] = useState<EmulatorStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (!containerRef.current) {
      setError('Container not ready');
      return;
    }

    if (emulatorRef.current) {
      emulatorRef.current.run();
      setStatus('running');
      return;
    }

    setStatus('loading');
    setError(null);

    try {
      await loadLibV86();

      if (!window.V86) {
        throw new Error('V86 not available after loading');
      }

      const options: V86Options = {
        wasm_path: `${V86_BASE_URL}v86.wasm`,
        bios: { url: `${V86_BASE_URL}seabios.bin` },
        vga_bios: { url: `${V86_BASE_URL}vgabios.bin` },
        memory_size: iso.memoryMb * 1024 * 1024,
        vga_memory_size: 8 * 1024 * 1024,
        screen_container: containerRef.current,
        autostart: true
      };

      if (iso.bootType === 'cdrom') {
        options.cdrom = { url: isoUrl };
      } else {
        options.hda = { url: isoUrl, async: true };
      }

      const emulator = new window.V86(options);
      emulatorRef.current = emulator;

      emulator.add_listener('emulator-ready', () => {
        setStatus('running');
      });

      emulator.add_listener('emulator-stopped', () => {
        setStatus('stopped');
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start emulator');
      setStatus('error');
    }
  }, [iso, isoUrl]);

  const stop = useCallback(() => {
    if (emulatorRef.current) {
      emulatorRef.current.stop();
      setStatus('stopped');
    }
  }, []);

  const restart = useCallback(() => {
    if (emulatorRef.current) {
      emulatorRef.current.restart();
      setStatus('running');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (emulatorRef.current) {
        emulatorRef.current.destroy();
        emulatorRef.current = null;
      }
    };
  }, []);

  return {
    containerRef,
    status,
    error,
    start,
    stop,
    restart
  };
}
