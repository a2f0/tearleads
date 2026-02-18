export type OpfsDirectoryEntryHandle =
  | FileSystemDirectoryHandle
  | FileSystemFileHandle;

interface FileSystemDirectoryEntriesHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, OpfsDirectoryEntryHandle]>;
}

function hasDirectoryEntries(
  directory: FileSystemDirectoryHandle
): directory is FileSystemDirectoryEntriesHandle {
  return 'entries' in directory;
}

export function getDirectoryEntries(
  directory: FileSystemDirectoryHandle
): AsyncIterableIterator<[string, OpfsDirectoryEntryHandle]> {
  if (!hasDirectoryEntries(directory)) {
    throw new Error('OPFS entries() is not supported in this environment');
  }

  return directory.entries();
}
