export interface IsoCatalogEntry {
  id: string;
  name: string;
  description: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256?: string;
  bootType: 'cdrom' | 'hda';
  memoryMb: number;
  cpuCount?: number;
}

export interface StoredIso {
  id: string;
  name: string;
  sizeBytes: number;
  downloadedAt: string;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export type EmulatorStatus =
  | 'idle'
  | 'loading'
  | 'running'
  | 'stopped'
  | 'error';

export interface V86Options {
  wasm_path: string;
  bios: { url: string };
  vga_bios: { url: string };
  cdrom?: { url: string };
  hda?: { url: string; async?: boolean; size?: number };
  memory_size: number;
  vga_memory_size: number;
  screen_container: HTMLElement;
  autostart?: boolean;
  disable_keyboard?: boolean;
  disable_mouse?: boolean;
  network_relay_url?: string;
}

export interface V86Emulator {
  run(): void;
  stop(): void;
  restart(): void;
  destroy(): void;
  add_listener(event: string, callback: (...args: unknown[]) => void): void;
  keyboard_send_scancodes(codes: number[]): void;
  serial0_send(text: string): void;
  save_state(): Promise<ArrayBuffer>;
  restore_state(state: ArrayBuffer): Promise<void>;
}
