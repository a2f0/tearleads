export { ClassicApp } from './components/ClassicApp';
export type { ClassicAppProps } from './components/classicAppState';
export {
  CREATE_CLASSIC_NOTE_ARIA_LABEL,
  CREATE_CLASSIC_TAG_ARIA_LABEL,
  DEFAULT_CLASSIC_NOTE_TITLE,
  DEFAULT_CLASSIC_TAG_NAME
} from './lib/constants';
export {
  deleteTag,
  getActiveTagNoteIds,
  moveItem,
  reorderNoteInTag,
  reorderNoteInTagToTarget,
  reorderTags,
  reorderTagToTarget,
  restoreTag,
  selectTag,
  softDeleteTag
} from './lib/ordering';
export type { EntrySortOrder, SortOption, TagSortOrder } from './lib/sorting';
export { ENTRY_SORT_OPTIONS, TAG_SORT_OPTIONS } from './lib/sorting';
export type {
  ClassicNote,
  ClassicState,
  ClassicTag,
  VfsLinkLikeRow,
  VfsNoteLikeRow,
  VfsRegistryLikeRow,
  VfsTagLikeRow
} from './lib/types';
export type {
  BuildClassicStateFromVfsArgs,
  SerializableOrderState
} from './lib/vfsClassicAdapter';
export {
  buildClassicStateFromVfs,
  serializeOrderState
} from './lib/vfsClassicAdapter';
export type { VfsLinkPositionUpdate } from './lib/vfsPositionUpdates';
export {
  buildClassicPositionUpdates,
  computePositionUpdatesForParent
} from './lib/vfsPositionUpdates';
