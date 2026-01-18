import type { FileSystemEntry } from './types';

export function calculateTotalSize(entries: FileSystemEntry[]): number {
  return entries.reduce((total, entry) => {
    if (entry.kind === 'file' && entry.size !== undefined) {
      return total + entry.size;
    }
    if (entry.kind === 'directory' && entry.children) {
      return total + calculateTotalSize(entry.children);
    }
    return total;
  }, 0);
}

export function countFiles(entries: FileSystemEntry[]): number {
  return entries.reduce((count, entry) => {
    if (entry.kind === 'file') {
      return count + 1;
    }
    if (entry.kind === 'directory' && entry.children) {
      return count + countFiles(entry.children);
    }
    return count;
  }, 0);
}

export async function readDirectory(
  handle: FileSystemDirectoryHandle
): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];

  for await (const [name, childHandle] of handle.entries()) {
    if (childHandle.kind === 'file') {
      const file = await childHandle.getFile();
      entries.push({
        name,
        kind: 'file',
        size: file.size
      });
    } else {
      const children = await readDirectory(childHandle);
      entries.push({
        name,
        kind: 'directory',
        children
      });
    }
  }

  // Sort: directories first, then files, alphabetically
  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return entries;
}

export function collectAllPaths(
  entries: FileSystemEntry[],
  parentPath: string
): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    const entryPath = `${parentPath}/${entry.name}`;
    if (entry.kind === 'directory') {
      paths.push(entryPath);
      if (entry.children) {
        paths.push(...collectAllPaths(entry.children, entryPath));
      }
    }
  }
  return paths;
}
