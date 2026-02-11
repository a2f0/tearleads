export interface ClassicTag {
  id: string;
  name: string;
}

export interface ClassicNote {
  id: string;
  title: string;
  body: string;
}

export interface ClassicState {
  tags: ClassicTag[];
  deletedTags: ClassicTag[];
  notesById: Record<string, ClassicNote>;
  noteOrderByTagId: Record<string, string[]>;
  activeTagId: string | null;
}

export interface VfsRegistryLikeRow {
  id: string;
  objectType: string;
}

export interface VfsTagLikeRow {
  id: string;
  encryptedName: string | null;
  deleted: boolean | null;
}

export interface VfsNoteLikeRow {
  id: string;
  title: string | null;
  content: string | null;
}

export interface VfsLinkLikeRow {
  parentId: string;
  childId: string;
  position: number | null;
}
