import type {
  ClassicNote,
  ClassicState,
  ClassicTag,
  VfsLinkLikeRow,
  VfsNoteLikeRow,
  VfsRegistryLikeRow,
  VfsTagLikeRow
} from './types';
import { buildClassicSortMetadata } from './sorting';

function sortByPositionThenId(a: VfsLinkLikeRow, b: VfsLinkLikeRow): number {
  const aPos = a.position ?? Number.MAX_SAFE_INTEGER;
  const bPos = b.position ?? Number.MAX_SAFE_INTEGER;

  if (aPos !== bPos) {
    return aPos - bPos;
  }

  return a.childId.localeCompare(b.childId);
}

function resolveTagName(name: string | null): string {
  if (!name || name.trim() === '') {
    return 'Unnamed Tag';
  }
  return name;
}

function resolveNoteTitle(title: string | null): string {
  if (!title || title.trim() === '') {
    return 'Untitled Note';
  }
  return title;
}

function resolveNoteBody(body: string | null): string {
  return body ?? '';
}

export interface BuildClassicStateFromVfsArgs {
  rootTagParentId: string;
  registryRows: VfsRegistryLikeRow[];
  tagRows: VfsTagLikeRow[];
  noteRows: VfsNoteLikeRow[];
  linkRows: VfsLinkLikeRow[];
}

export function buildClassicStateFromVfs(
  args: BuildClassicStateFromVfsArgs
): ClassicState {
  const tagIdsInRegistry = new Set(
    args.registryRows
      .filter((row) => row.objectType === 'tag')
      .map((row) => row.id)
  );

  const noteIdsInRegistry = new Set(
    args.registryRows
      .filter((row) => row.objectType === 'note')
      .map((row) => row.id)
  );

  const activeTagsById = new Map<string, ClassicTag>();
  const deletedTagsById = new Map<string, ClassicTag>();
  for (const row of args.tagRows) {
    if (!tagIdsInRegistry.has(row.id)) {
      continue;
    }
    const targetMap = row.deleted ? deletedTagsById : activeTagsById;
    targetMap.set(row.id, {
      id: row.id,
      name: resolveTagName(row.encryptedName)
    });
  }

  const notesById: Record<string, ClassicNote> = {};
  for (const row of args.noteRows) {
    if (!noteIdsInRegistry.has(row.id)) {
      continue;
    }
    notesById[row.id] = {
      id: row.id,
      title: resolveNoteTitle(row.title),
      body: resolveNoteBody(row.content)
    };
  }

  const tagLinks = args.linkRows
    .filter((link) => link.parentId === args.rootTagParentId)
    .sort(sortByPositionThenId);

  const tags = tagLinks
    .map((link) => activeTagsById.get(link.childId))
    .filter((tag): tag is ClassicTag => tag !== undefined);
  const deletedTags = tagLinks
    .map((link) => deletedTagsById.get(link.childId))
    .filter((tag): tag is ClassicTag => tag !== undefined);

  const noteOrderByTagId: Record<string, string[]> = {};
  for (const tag of tags) {
    const orderedNoteIds = args.linkRows
      .filter((link) => link.parentId === tag.id)
      .filter((link) => notesById[link.childId] !== undefined)
      .sort(sortByPositionThenId)
      .map((link) => link.childId);
    noteOrderByTagId[tag.id] = orderedNoteIds;
  }

  const activeTagId = tags[0]?.id ?? null;
  const sortMetadata = buildClassicSortMetadata({
    registryRows: args.registryRows,
    noteRows: args.noteRows,
    linkRows: args.linkRows
  });

  return {
    tags,
    deletedTags,
    notesById,
    noteOrderByTagId,
    activeTagId,
    sortMetadata
  };
}

export interface SerializableOrderState {
  tagOrder: string[];
  noteOrderByTagId: Record<string, string[]>;
}

export function serializeOrderState(
  state: ClassicState
): SerializableOrderState {
  return {
    tagOrder: state.tags.map((tag) => tag.id),
    noteOrderByTagId: state.noteOrderByTagId
  };
}
