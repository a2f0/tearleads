export type { ClassicAppProps } from './components/ClassicApp';
export { ClassicApp } from './components/ClassicApp';
export {
  getActiveTagNoteIds,
  moveItem,
  reorderNoteInTag,
  reorderNoteInTagToTarget,
  reorderTags,
  reorderTagToTarget,
  selectTag
} from './lib/ordering';
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
