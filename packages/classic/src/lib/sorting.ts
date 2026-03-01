import type { ClassicSortMetadata, ClassicState, ClassicTag } from './types';

export type TagSortOrder =
  | 'user-defined'
  | 'name-asc'
  | 'name-desc'
  | 'date-created-asc'
  | 'date-created-desc'
  | 'entry-count-asc'
  | 'entry-count-desc'
  | 'date-last-used-asc'
  | 'date-last-used-desc';

export type EntrySortOrder =
  | 'user-defined'
  | 'date-tagged-asc'
  | 'date-tagged-desc'
  | 'subject-asc'
  | 'subject-desc'
  | 'body-asc'
  | 'body-desc'
  | 'date-created-asc'
  | 'date-created-desc'
  | 'date-updated-asc'
  | 'date-updated-desc'
  | 'tag-count-asc'
  | 'tag-count-desc';

export interface SortOption<T extends string> {
  value: T;
  label: string;
}

export const TAG_SORT_OPTIONS: readonly SortOption<TagSortOrder>[] = [
  { value: 'user-defined', label: 'User Defined Order' },
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'date-created-asc', label: 'Date Created (Oldest First)' },
  { value: 'date-created-desc', label: 'Date Created (Newest First)' },
  { value: 'entry-count-asc', label: 'Entry Count (Low to High)' },
  { value: 'entry-count-desc', label: 'Entry Count (High to Low)' },
  { value: 'date-last-used-asc', label: 'Date Last Used (Oldest First)' },
  { value: 'date-last-used-desc', label: 'Date Last Used (Newest First)' }
];

export const ENTRY_SORT_OPTIONS: readonly SortOption<EntrySortOrder>[] = [
  { value: 'user-defined', label: 'User Defined Order' },
  { value: 'date-tagged-asc', label: 'Date Tagged (Oldest First)' },
  { value: 'date-tagged-desc', label: 'Date Tagged (Newest First)' },
  { value: 'subject-asc', label: 'Subject (A-Z)' },
  { value: 'subject-desc', label: 'Subject (Z-A)' },
  { value: 'body-asc', label: 'Body (A-Z)' },
  { value: 'body-desc', label: 'Body (Z-A)' },
  { value: 'date-created-asc', label: 'Date Created (Oldest First)' },
  { value: 'date-created-desc', label: 'Date Created (Newest First)' },
  { value: 'date-updated-asc', label: 'Date Updated (Oldest First)' },
  { value: 'date-updated-desc', label: 'Date Updated (Newest First)' },
  { value: 'tag-count-asc', label: 'Tag Count (Low to High)' },
  { value: 'tag-count-desc', label: 'Tag Count (High to Low)' }
];

const tagSortOrderValues: ReadonlySet<string> = new Set(
  TAG_SORT_OPTIONS.map((option) => option.value)
);
const entrySortOrderValues: ReadonlySet<string> = new Set(
  ENTRY_SORT_OPTIONS.map((option) => option.value)
);

export function isTagSortOrder(value: string): value is TagSortOrder {
  return tagSortOrderValues.has(value);
}

export function isEntrySortOrder(value: string): value is EntrySortOrder {
  return entrySortOrderValues.has(value);
}

function compareText(
  left: string,
  right: string,
  descending: boolean = false
): number {
  const value = left.localeCompare(right, undefined, { sensitivity: 'base' });
  return descending ? -value : value;
}

function compareNumber(
  left: number,
  right: number,
  descending: boolean = false
): number {
  return descending ? right - left : left - right;
}

function compareNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  descending: boolean = false
): number {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  if (leftMissing || rightMissing) {
    return Number(leftMissing) - Number(rightMissing);
  }
  return compareNumber(left, right, descending);
}

function toTimestamp(value: Date | null | undefined): number | null {
  if (!value) {
    return null;
  }
  return value.getTime();
}

function buildTagCountById(state: ClassicState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tag of state.tags) {
    counts[tag.id] = state.noteOrderByTagId[tag.id]?.length ?? 0;
  }
  return counts;
}

function getNoteTagCountById(state: ClassicState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const noteId of Object.keys(state.notesById)) {
    counts[noteId] = 0;
  }
  for (const noteIds of Object.values(state.noteOrderByTagId)) {
    for (const noteId of noteIds) {
      counts[noteId] = (counts[noteId] ?? 0) + 1;
    }
  }
  return counts;
}

interface SortTagsArgs {
  state: ClassicState;
  tags: readonly ClassicTag[];
  sortOrder: TagSortOrder;
  noteCountByTagId?: Readonly<Record<string, number>>;
}

export function sortTags({
  state,
  tags,
  sortOrder,
  noteCountByTagId
}: SortTagsArgs): ClassicTag[] {
  if (sortOrder === 'user-defined') {
    return [...tags];
  }

  const counts = noteCountByTagId ?? buildTagCountById(state);
  const tagCreatedAtById = state.sortMetadata?.tagCreatedAtById ?? {};
  const tagLastUsedAtById = state.sortMetadata?.tagLastUsedAtById ?? {};
  const sorted = [...tags];

  sorted.sort((left, right) => {
    let primary = 0;
    switch (sortOrder) {
      case 'name-asc':
        primary = compareText(left.name, right.name);
        break;
      case 'name-desc':
        primary = compareText(left.name, right.name, true);
        break;
      case 'date-created-asc':
        primary = compareNullableNumber(
          tagCreatedAtById[left.id],
          tagCreatedAtById[right.id]
        );
        break;
      case 'date-created-desc':
        primary = compareNullableNumber(
          tagCreatedAtById[left.id],
          tagCreatedAtById[right.id],
          true
        );
        break;
      case 'entry-count-asc':
        primary = compareNumber(counts[left.id] ?? 0, counts[right.id] ?? 0);
        break;
      case 'entry-count-desc':
        primary = compareNumber(
          counts[left.id] ?? 0,
          counts[right.id] ?? 0,
          true
        );
        break;
      case 'date-last-used-asc':
        primary = compareNullableNumber(
          tagLastUsedAtById[left.id],
          tagLastUsedAtById[right.id]
        );
        break;
      case 'date-last-used-desc':
        primary = compareNullableNumber(
          tagLastUsedAtById[left.id],
          tagLastUsedAtById[right.id],
          true
        );
        break;
    }

    if (primary !== 0) {
      return primary;
    }

    return left.id.localeCompare(right.id);
  });

  return sorted;
}

interface SortNoteIdsArgs {
  state: ClassicState;
  noteIds: readonly string[];
  activeTagId: string | null;
  sortOrder: EntrySortOrder;
}

export function sortNoteIds({
  state,
  noteIds,
  activeTagId,
  sortOrder
}: SortNoteIdsArgs): string[] {
  if (sortOrder === 'user-defined') {
    return [...noteIds];
  }

  const noteTaggedAtByTagId = state.sortMetadata?.noteTaggedAtByTagId ?? {};
  const noteTaggedAtById = activeTagId
    ? (noteTaggedAtByTagId[activeTagId] ?? {})
    : {};
  if (
    (sortOrder === 'date-tagged-asc' || sortOrder === 'date-tagged-desc') &&
    activeTagId === null
  ) {
    return [...noteIds];
  }

  const noteCreatedAtById = state.sortMetadata?.noteCreatedAtById ?? {};
  const noteUpdatedAtById = state.sortMetadata?.noteUpdatedAtById ?? {};
  const noteTagCountById = getNoteTagCountById(state);
  const sorted = [...noteIds];

  sorted.sort((leftId, rightId) => {
    const leftNote = state.notesById[leftId];
    const rightNote = state.notesById[rightId];

    let primary = 0;
    switch (sortOrder) {
      case 'date-tagged-asc':
        primary = compareNullableNumber(
          noteTaggedAtById[leftId],
          noteTaggedAtById[rightId]
        );
        break;
      case 'date-tagged-desc':
        primary = compareNullableNumber(
          noteTaggedAtById[leftId],
          noteTaggedAtById[rightId],
          true
        );
        break;
      case 'subject-asc':
        primary = compareText(leftNote?.title ?? '', rightNote?.title ?? '');
        break;
      case 'subject-desc':
        primary = compareText(
          leftNote?.title ?? '',
          rightNote?.title ?? '',
          true
        );
        break;
      case 'body-asc':
        primary = compareText(leftNote?.body ?? '', rightNote?.body ?? '');
        break;
      case 'body-desc':
        primary = compareText(
          leftNote?.body ?? '',
          rightNote?.body ?? '',
          true
        );
        break;
      case 'date-created-asc':
        primary = compareNullableNumber(
          noteCreatedAtById[leftId],
          noteCreatedAtById[rightId]
        );
        break;
      case 'date-created-desc':
        primary = compareNullableNumber(
          noteCreatedAtById[leftId],
          noteCreatedAtById[rightId],
          true
        );
        break;
      case 'date-updated-asc':
        primary = compareNullableNumber(
          noteUpdatedAtById[leftId],
          noteUpdatedAtById[rightId]
        );
        break;
      case 'date-updated-desc':
        primary = compareNullableNumber(
          noteUpdatedAtById[leftId],
          noteUpdatedAtById[rightId],
          true
        );
        break;
      case 'tag-count-asc':
        primary = compareNumber(
          noteTagCountById[leftId] ?? 0,
          noteTagCountById[rightId] ?? 0
        );
        break;
      case 'tag-count-desc':
        primary = compareNumber(
          noteTagCountById[leftId] ?? 0,
          noteTagCountById[rightId] ?? 0,
          true
        );
        break;
    }

    if (primary !== 0) {
      return primary;
    }

    return leftId.localeCompare(rightId);
  });

  return sorted;
}

interface BuildClassicSortMetadataArgs {
  registryRows: ReadonlyArray<{
    id: string;
    objectType: string;
    createdAt?: Date | null;
  }>;
  noteRows: ReadonlyArray<{
    id: string;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  }>;
  linkRows: ReadonlyArray<{
    parentId: string;
    childId: string;
    createdAt?: Date | null;
  }>;
}

export function buildClassicSortMetadata({
  registryRows,
  noteRows,
  linkRows
}: BuildClassicSortMetadataArgs): ClassicSortMetadata {
  const tagCreatedAtById: Record<string, number | null> = {};
  const noteCreatedAtById: Record<string, number | null> = {};
  const noteUpdatedAtById: Record<string, number | null> = {};
  const noteTaggedAtByTagId: Record<string, Record<string, number | null>> = {};

  for (const row of registryRows) {
    if (row.objectType === 'tag') {
      tagCreatedAtById[row.id] = toTimestamp(row.createdAt);
    }
    if (row.objectType === 'note') {
      noteCreatedAtById[row.id] = toTimestamp(row.createdAt);
    }
  }

  for (const row of noteRows) {
    noteCreatedAtById[row.id] =
      toTimestamp(row.createdAt) ?? noteCreatedAtById[row.id] ?? null;
    noteUpdatedAtById[row.id] = toTimestamp(row.updatedAt);
  }

  for (const row of linkRows) {
    let taggedAtById = noteTaggedAtByTagId[row.parentId];
    if (taggedAtById === undefined) {
      taggedAtById = {};
      noteTaggedAtByTagId[row.parentId] = taggedAtById;
    }
    taggedAtById[row.childId] = toTimestamp(row.createdAt);
  }

  const tagLastUsedAtById: Record<string, number | null> = {};
  for (const [tagId, createdAt] of Object.entries(tagCreatedAtById)) {
    let latest = createdAt;
    const taggedRows = noteTaggedAtByTagId[tagId];
    if (taggedRows) {
      for (const taggedAt of Object.values(taggedRows)) {
        if (taggedAt !== null && (latest === null || taggedAt > latest)) {
          latest = taggedAt;
        }
      }
    }
    tagLastUsedAtById[tagId] = latest;
  }

  return {
    tagCreatedAtById,
    tagLastUsedAtById,
    noteCreatedAtById,
    noteUpdatedAtById,
    noteTaggedAtByTagId
  };
}
