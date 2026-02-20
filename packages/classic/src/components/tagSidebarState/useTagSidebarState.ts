/**
 * Hook for TagSidebar state management.
 */

import { useEffect, useRef, useState } from 'react';
import type { ClassicTag } from '../../lib/types';
import type { TagContextMenuState } from './types';

interface UseTagSidebarStateOptions {
  tags: ClassicTag[];
  editingTagId?: string | null | undefined;
  autoFocusSearch?: boolean | undefined;
  onRenameTag?: ((tagId: string, newName: string) => void) | undefined;
  onCancelEditTag?: (() => void) | undefined;
  searchInputRef?: React.RefObject<HTMLInputElement | null> | undefined;
}

export function useTagSidebarState({
  tags,
  editingTagId,
  autoFocusSearch,
  onRenameTag,
  onCancelEditTag,
  searchInputRef
}: UseTagSidebarStateOptions) {
  const [contextMenu, setContextMenu] = useState<TagContextMenuState | null>(
    null
  );
  const [draggedTagId, setDraggedTagId] = useState<string | null>(null);
  const [lastHoverTagId, setLastHoverTagId] = useState<string | null>(null);
  const [dragArmedTagId, setDragArmedTagId] = useState<string | null>(null);
  const [dropTargetTagId, setDropTargetTagId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const localSearchInputRef = useRef<HTMLInputElement>(null);
  const effectiveSearchInputRef = searchInputRef ?? localSearchInputRef;

  useEffect(() => {
    if (autoFocusSearch) {
      effectiveSearchInputRef.current?.focus();
    }
  }, [autoFocusSearch, effectiveSearchInputRef]);

  useEffect(() => {
    if (editingTagId) {
      const tag = tags.find((t) => t.id === editingTagId);
      setEditValue(tag?.name ?? '');
      setTimeout(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      }, 0);
    }
  }, [editingTagId, tags]);

  const closeContextMenu = () => setContextMenu(null);

  const commitOrCancelEdit = (tagId: string) => {
    if (editValue.trim() && onRenameTag) {
      onRenameTag(tagId, editValue.trim());
    } else {
      onCancelEditTag?.();
    }
  };

  const handleEditKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    tagId: string
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitOrCancelEdit(tagId);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancelEditTag?.();
    }
  };

  const handleEditBlur = (tagId: string) => {
    setTimeout(() => {
      const activeElement = document.activeElement;
      const isStillEditing =
        activeElement === editInputRef.current ||
        activeElement?.closest(`[data-tag-id="${tagId}"]`);
      if (!isStillEditing) {
        commitOrCancelEdit(tagId);
      }
    }, 0);
  };

  const handleSave = (tagId: string) => {
    if (editValue.trim() && onRenameTag) {
      onRenameTag(tagId, editValue.trim());
    } else {
      onCancelEditTag?.();
    }
  };

  const handleCancel = () => {
    onCancelEditTag?.();
  };

  return {
    contextMenu,
    setContextMenu,
    draggedTagId,
    setDraggedTagId,
    lastHoverTagId,
    setLastHoverTagId,
    dragArmedTagId,
    setDragArmedTagId,
    dropTargetTagId,
    setDropTargetTagId,
    editValue,
    setEditValue,
    editInputRef,
    effectiveSearchInputRef,
    closeContextMenu,
    handleEditKeyDown,
    handleEditBlur,
    handleSave,
    handleCancel
  };
}
