import type { DownloadProgress, IsoCatalogEntry, StoredIso } from './types';

const ISO_DIRECTORY = 'v86-isos';
const METADATA_FILE = 'metadata.json';

interface IsoMetadata {
  isos: StoredIso[];
}

function isIsoFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const looksLikeIso = name.endsWith('.iso');
  const typeMatches =
    file.type === 'application/x-iso9660-image' ||
    file.type === 'application/octet-stream';
  return looksLikeIso || typeMatches;
}

function createUploadId(file: File): string {
  const baseName = file.name.replace(/\.[^/.]+$/, '').trim();
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const nonce =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `uploaded-${slug || 'iso'}-${nonce}`;
}

async function getIsoDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ISO_DIRECTORY, { create: true });
}

async function readMetadata(): Promise<IsoMetadata> {
  try {
    const dir = await getIsoDirectory();
    const fileHandle = await dir.getFileHandle(METADATA_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text) as IsoMetadata;
  } catch {
    return { isos: [] };
  }
}

async function writeMetadata(metadata: IsoMetadata): Promise<void> {
  const dir = await getIsoDirectory();
  const fileHandle = await dir.getFileHandle(METADATA_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(metadata, null, 2));
  await writable.close();
}

export async function listDownloadedIsos(): Promise<StoredIso[]> {
  const metadata = await readMetadata();
  return metadata.isos;
}

export async function isIsoDownloaded(id: string): Promise<boolean> {
  const metadata = await readMetadata();
  return metadata.isos.some((iso) => iso.id === id);
}

export async function downloadIso(
  entry: IsoCatalogEntry,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const response = await fetch(entry.downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download ISO: ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : entry.sizeBytes;

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }

  // Stream directly to file to avoid memory issues with large ISOs
  const dir = await getIsoDirectory();
  const filename = `${entry.id}.iso`;
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    await writable.write(value);
    loaded += value.length;

    if (onProgress) {
      onProgress({
        loaded,
        total,
        percentage: Math.round((loaded / total) * 100)
      });
    }
  }
  await writable.close();

  const metadata = await readMetadata();
  const existingIndex = metadata.isos.findIndex((iso) => iso.id === entry.id);

  const storedIso: StoredIso = {
    id: entry.id,
    name: entry.name,
    sizeBytes: loaded,
    downloadedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    metadata.isos[existingIndex] = storedIso;
  } else {
    metadata.isos.push(storedIso);
  }

  await writeMetadata(metadata);
}

export async function uploadIso(file: File): Promise<StoredIso> {
  if (!isIsoFile(file)) {
    throw new Error('Only .iso files are supported');
  }

  const dir = await getIsoDirectory();
  const id = createUploadId(file);
  const filename = `${id}.iso`;
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();

  const metadata = await readMetadata();
  const storedIso: StoredIso = {
    id,
    name: file.name,
    sizeBytes: file.size,
    downloadedAt: new Date().toISOString()
  };

  metadata.isos.push(storedIso);
  await writeMetadata(metadata);

  return storedIso;
}

export async function getIsoUrl(id: string): Promise<string> {
  const dir = await getIsoDirectory();
  const filename = `${id}.iso`;
  const fileHandle = await dir.getFileHandle(filename);
  const file = await fileHandle.getFile();
  return URL.createObjectURL(file);
}

export async function getIsoFile(id: string): Promise<File | null> {
  try {
    const dir = await getIsoDirectory();
    const filename = `${id}.iso`;
    const fileHandle = await dir.getFileHandle(filename);
    return fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function deleteIso(id: string): Promise<void> {
  const dir = await getIsoDirectory();
  const filename = `${id}.iso`;

  try {
    await dir.removeEntry(filename);
  } catch {
    // File might not exist
  }

  const metadata = await readMetadata();
  metadata.isos = metadata.isos.filter((iso) => iso.id !== id);
  await writeMetadata(metadata);
}

export async function getStorageUsage(): Promise<{
  used: number;
  available: number;
}> {
  const estimate = await navigator.storage.estimate();
  const metadata = await readMetadata();

  const used = metadata.isos.reduce((sum, iso) => sum + iso.sizeBytes, 0);
  const quota =
    typeof estimate.quota === 'number' ? estimate.quota : undefined;
  const usage =
    typeof estimate.usage === 'number' ? estimate.usage : undefined;

  return {
    used,
    available:
      quota !== undefined && usage !== undefined
        ? Math.max(0, quota - usage)
        : 0
  };
}

export function isOpfsSupported(): boolean {
  return 'storage' in navigator && 'getDirectory' in navigator.storage;
}
