export interface DocumentInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
  deleted: boolean;
}

export interface DocumentWithUrl extends DocumentInfo {
  thumbnailUrl: string | null;
}

export type SortColumn = 'name' | 'size' | 'mimeType' | 'uploadDate';
export type SortDirection = 'asc' | 'desc';

export const DOCUMENT_TYPE_MAP: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'application/json': 'JSON'
};

export function getDocumentTypeLabel(mimeType: string): string {
  if (DOCUMENT_TYPE_MAP[mimeType]) {
    return DOCUMENT_TYPE_MAP[mimeType];
  }
  const [, subtype] = mimeType.split('/');
  return subtype ? subtype.toUpperCase() : 'Document';
}
