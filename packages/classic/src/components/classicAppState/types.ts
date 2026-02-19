/**
 * Types for ClassicApp component.
 */

import type { EntrySortOrder, TagSortOrder } from '../../lib/sorting';
import type { ClassicState } from '../../lib/types';
import type { ClassicContextMenuComponents } from '../ClassicContextMenu';

export interface ClassicAppProps {
  initialState: ClassicState;
  autoFocusSearch?: boolean;
  tagSortOrder?: TagSortOrder | undefined;
  entrySortOrder?: EntrySortOrder | undefined;
  onTagSortOrderChange?: ((nextSortOrder: TagSortOrder) => void) | undefined;
  onEntrySortOrderChange?:
    | ((nextSortOrder: EntrySortOrder) => void)
    | undefined;
  showSortControls?: boolean | undefined;
  onStateChange?: ((state: ClassicState) => void) | undefined;
  onCreateTag?:
    | ((tagId: string, name: string) => void | Promise<void>)
    | undefined;
  onDeleteTag?: ((tagId: string) => void | Promise<void>) | undefined;
  onRestoreTag?: ((tagId: string) => void | Promise<void>) | undefined;
  onRenameTag?:
    | ((tagId: string, newName: string) => void | Promise<void>)
    | undefined;
  onCreateNote?:
    | ((
        noteId: string,
        tagId: string | null,
        title: string,
        body: string
      ) => void | Promise<void>)
    | undefined;
  onUpdateNote?:
    | ((noteId: string, title: string, body: string) => void | Promise<void>)
    | undefined;
  contextMenuComponents?: ClassicContextMenuComponents | undefined;
}
