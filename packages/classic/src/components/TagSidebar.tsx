import { useEffect, useRef, useState } from 'react';
import {
  CREATE_CLASSIC_TAG_ARIA_LABEL,
  DEFAULT_CLASSIC_TAG_NAME,
  DRAG_TYPE_NOTE,
  DRAG_TYPE_TAG,
  UNTAGGED_TAG_ID,
  UNTAGGED_TAG_NAME
} from '../lib/constants';
import type { ClassicTag } from '../lib/types';
import {
  ClassicContextMenu,
  type ClassicContextMenuComponents
} from './ClassicContextMenu';

interface TagSidebarProps {
  tags: ClassicTag[];
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
  onTagNote?: (tagId: string, noteId: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  contextMenuComponents?: ClassicContextMenuComponents | undefined;
}

interface TagContextMenuState {
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

export function TagSidebar({
  tags,
  activeTagId,
  editingTagId,
  autoFocusSearch,
  untaggedCount = 0,
  noteCountByTagId = {},
  onSelectTag,
  onMoveTag,
  onReorderTag,
  onCreateTag,
  onStartEditTag,
  onRenameTag,
  onCancelEditTag,
  onDeleteTag,
  onTagNote,
  searchValue,
  onSearchChange,
  onSearchKeyDown,
  searchInputRef,
  contextMenuComponents
}: TagSidebarProps) {
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
    commitOrCancelEdit(tagId);
  };
  const openEmptySpaceContextMenu = (x: number, y: number) => {
    setContextMenu({
      x,
      y,
      ariaLabel: 'Tag list actions',
      actions: [
        {
          label: DEFAULT_CLASSIC_TAG_NAME,
          onClick: () => {
            void onCreateTag?.();
          },
          ariaLabel: CREATE_CLASSIC_TAG_ARIA_LABEL,
          disabled: onCreateTag === undefined
        }
      ]
    });
  };

  return (
    <aside className="flex w-64 flex-col border-r" aria-label="Tags Sidebar">
      {/* biome-ignore lint/a11y/useSemanticElements: div with role=button required for flexible layout container */}
      <div
        role="button"
        aria-label="Tag list, press Shift+F10 for context menu"
        tabIndex={0}
        className="flex-1 overflow-auto py-3 focus:outline-none"
        onContextMenu={(event) => {
          event.preventDefault();
          openEmptySpaceContextMenu(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          const isContextMenuKey =
            event.key === 'ContextMenu' ||
            (event.key === 'F10' && event.shiftKey);
          if (!isContextMenuKey) {
            return;
          }
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          openEmptySpaceContextMenu(rect.left + 8, rect.top + 8);
        }}
      >
        <div className="pr-2">
          {/* Untagged Items virtual tag */}
          {untaggedCount > 0 && (
            <ul className="m-0 mb-2 list-none p-0" aria-label="Virtual Tags">
              <li
                className={
                  activeTagId === UNTAGGED_TAG_ID
                    ? 'border bg-zinc-200 px-2 py-0.5'
                    : 'border bg-white px-2 py-0.5'
                }
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="w-4 shrink-0 select-none text-center text-xs text-zinc-400"
                  >
                    📁
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-left text-sm"
                    onClick={() => onSelectTag(UNTAGGED_TAG_ID)}
                    aria-pressed={activeTagId === UNTAGGED_TAG_ID}
                    aria-label={`Select ${UNTAGGED_TAG_NAME}`}
                  >
                    <span className="text-zinc-700">
                      {UNTAGGED_TAG_NAME} ({untaggedCount})
                    </span>
                  </button>
                </div>
              </li>
            </ul>
          )}
          {tags.length === 0 && untaggedCount === 0 && (
            <p className="text-sm text-zinc-500">No tags found.</p>
          )}
          {tags.length > 0 && (
            <ul className="m-0 list-none space-y-1 p-0" aria-label="Tag List">
              {tags.map((tag, index) => {
                const isActive = tag.id === activeTagId;
                const canMoveUp = index > 0;
                const canMoveDown = index < tags.length - 1;
                return (
                  <li
                    key={tag.id}
                    className={
                      dropTargetTagId === tag.id
                        ? 'border bg-emerald-100 px-2 py-0.5'
                        : isActive
                          ? 'border bg-zinc-200 px-2 py-0.5'
                          : 'border bg-white px-2 py-0.5'
                    }
                    style={
                      dropTargetTagId === tag.id
                        ? { backgroundColor: '#d1fae5' }
                        : undefined
                    }
                    draggable
                    onDragStart={(event) => {
                      const target = event.target;
                      if (
                        dragArmedTagId !== tag.id &&
                        (!(target instanceof HTMLElement) ||
                          !target.closest('[data-drag-handle="true"]'))
                      ) {
                        event.preventDefault();
                        return;
                      }
                      setDraggedTagId(tag.id);
                      setLastHoverTagId(null);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', tag.id);
                      event.dataTransfer.setData(DRAG_TYPE_TAG, tag.id);
                    }}
                    onDragEnd={() => {
                      setDraggedTagId(null);
                      setLastHoverTagId(null);
                      setDragArmedTagId(null);
                      setDropTargetTagId(null);
                    }}
                    onDragOver={(event) => {
                      const types = event.dataTransfer?.types ?? [];
                      const hasNote = types.includes(DRAG_TYPE_NOTE);
                      const hasPlainText = types.includes('text/plain');
                      const hasSafariPlainText = types.includes(
                        'public.utf8-plain-text'
                      );
                      const hasExternalClassicNoteDrag =
                        (hasPlainText || hasSafariPlainText) &&
                        draggedTagId === null;
                      if (
                        (hasNote || hasExternalClassicNoteDrag) &&
                        onTagNote
                      ) {
                        event.preventDefault();
                        if (dropTargetTagId !== tag.id) {
                          setDropTargetTagId(tag.id);
                        }
                        return;
                      }
                      if (dropTargetTagId === tag.id) {
                        setDropTargetTagId(null);
                      }
                      if (!draggedTagId || draggedTagId === tag.id) {
                        return;
                      }
                      event.preventDefault();
                      if (lastHoverTagId === tag.id) {
                        return;
                      }
                      onReorderTag(draggedTagId, tag.id);
                      setLastHoverTagId(tag.id);
                    }}
                    onDragEnter={(event) => {
                      const types = event.dataTransfer?.types ?? [];
                      const hasNote = types.includes(DRAG_TYPE_NOTE);
                      const hasPlainText = types.includes('text/plain');
                      const hasSafariPlainText = types.includes(
                        'public.utf8-plain-text'
                      );
                      const hasExternalClassicNoteDrag =
                        (hasPlainText || hasSafariPlainText) &&
                        draggedTagId === null;
                      if (
                        (hasNote || hasExternalClassicNoteDrag) &&
                        onTagNote &&
                        dropTargetTagId !== tag.id
                      ) {
                        setDropTargetTagId(tag.id);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragArmedTagId(null);
                      setDropTargetTagId(null);
                      const customNoteId =
                        event.dataTransfer.getData(DRAG_TYPE_NOTE);
                      const fallbackNoteId =
                        draggedTagId === null
                          ? event.dataTransfer.getData('text/plain') ||
                            event.dataTransfer.getData(
                              'public.utf8-plain-text'
                            )
                          : '';
                      const noteId = customNoteId || fallbackNoteId;
                      if (noteId && onTagNote) {
                        onTagNote(tag.id, noteId);
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTargetTagId === tag.id) {
                        setDropTargetTagId(null);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const actions: TagContextMenuState['actions'] = [];
                      if (onStartEditTag) {
                        actions.push({
                          label: 'Edit',
                          onClick: () => onStartEditTag(tag.id),
                          ariaLabel: `Edit tag ${tag.name}`
                        });
                      }
                      if (canMoveUp) {
                        actions.push({
                          label: 'Move Up',
                          onClick: () => onMoveTag(tag.id, 'up'),
                          ariaLabel: `Move tag ${tag.name} up`
                        });
                      }
                      if (canMoveDown) {
                        actions.push({
                          label: 'Move Down',
                          onClick: () => onMoveTag(tag.id, 'down'),
                          ariaLabel: `Move tag ${tag.name} down`
                        });
                      }
                      if (onDeleteTag) {
                        actions.push({
                          label: 'Delete',
                          onClick: () => onDeleteTag(tag.id),
                          ariaLabel: `Delete tag ${tag.name}`
                        });
                      }
                      setContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        ariaLabel: `Tag actions for ${tag.name}`,
                        actions
                      });
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        data-drag-handle="true"
                        onMouseDown={() => setDragArmedTagId(tag.id)}
                        onMouseUp={() => setDragArmedTagId(null)}
                        className={
                          draggedTagId === tag.id
                            ? 'w-4 shrink-0 cursor-grabbing select-none text-center text-xs text-zinc-500'
                            : 'w-4 shrink-0 cursor-grab select-none text-center text-xs text-zinc-400'
                        }
                        title="Drag tag"
                      >
                        ⋮⋮
                      </span>
                      {editingTagId === tag.id ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleEditKeyDown(e, tag.id)}
                          onBlur={() => handleEditBlur(tag.id)}
                          className="min-w-0 flex-1 border border-zinc-300 px-1.5 py-0.5 text-base text-sm focus:border-zinc-500 focus:outline-none"
                          aria-label={`Edit tag ${tag.name}`}
                        />
                      ) : (
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-left text-sm"
                          onClick={() => onSelectTag(tag.id)}
                          aria-pressed={isActive}
                          aria-label={`Select tag ${tag.name}`}
                        >
                          <span className="text-zinc-700">
                            {tag.name}
                            {noteCountByTagId[tag.id] !== undefined &&
                              ` (${noteCountByTagId[tag.id]})`}
                          </span>
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <div className="py-3">
        <div className="pr-2">
          <input
            ref={effectiveSearchInputRef}
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="box-border w-full border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none"
            aria-label="Search tags"
          />
        </div>
      </div>
      {contextMenu && (
        <ClassicContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel={contextMenu.ariaLabel}
          onClose={closeContextMenu}
          actions={contextMenu.actions}
          {...(contextMenuComponents
            ? { components: contextMenuComponents }
            : {})}
        />
      )}
    </aside>
  );
}
