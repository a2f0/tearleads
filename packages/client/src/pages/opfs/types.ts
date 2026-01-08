export interface FileSystemEntry {
  name: string;
  kind: 'file' | 'directory';
  size?: number;
  children?: FileSystemEntry[];
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}
