/**
 * Types for TagSidebar component.
 */

import type { ClassicTag } from '../../lib/types';
import type { ClassicContextMenuComponents } from '../ClassicContextMenu';

export interface TagSidebarProps {
  tags: ClassicTag[];
  deletedTags?: ClassicTag[];
  activeTagId: string | null;
  editingTagId?: string | null;
  autoFocusSearch?: boolean;
  untaggedCount?: number;
  noteCountByTagId?: Record<string, number>;
  onSelectTag: (tagId: string) => void;
  onMoveTag: (tagId: string, direction: 'up' | 'down') => void;
  onReorderTag: (tagId: string, targetTagId: string) => void;
  onCreateTag?: (() => void | Promise<void>) | undefined;
  onStartEditTag?: (tagId: string) => void;
  onRenameTag?: (tagId: string, newName: string) => void;
  onCancelEditTag?: () => void;
  onDeleteTag?: (tagId: string) => void;
  onRestoreTag?: (tagId: string) => void;
  onTagNote?: (tagId: string, noteId: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  contextMenuComponents?: ClassicContextMenuComponents | undefined;
}

export interface TagContextMenuState {
  x: number;
  y: number;
  actions: Array<{
    label: string;
    onClick: () => void;
    disabled?: boolean;
    ariaLabel: string;
  }>;
  ariaLabel: string;
}
