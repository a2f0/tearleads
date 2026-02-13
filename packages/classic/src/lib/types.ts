export interface ClassicTag {
  id: string;
  name: string;
}

export interface ClassicNote {
  id: string;
  title: string;
  body: string;
}

export interface ClassicSortMetadata {
  tagCreatedAtById: Record<string, number | null>;
  tagLastUsedAtById: Record<string, number | null>;
  noteCreatedAtById: Record<string, number | null>;
  noteUpdatedAtById: Record<string, number | null>;
  noteTaggedAtByTagId: Record<string, Record<string, number | null>>;
}

export interface ClassicState {
  tags: ClassicTag[];
  deletedTags: ClassicTag[];
  notesById: Record<string, ClassicNote>;
  noteOrderByTagId: Record<string, string[]>;
  activeTagId: string | null;
  sortMetadata?: ClassicSortMetadata;
}

export interface VfsRegistryLikeRow {
  id: string;
  objectType: string;
  createdAt?: Date | null;
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
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface VfsLinkLikeRow {
  parentId: string;
  childId: string;
  position: number | null;
  createdAt?: Date | null;
}
