import { useTranslation } from 'react-i18next';
import {
  ALL_ENTRIES_TAG_ID,
  ALL_ENTRIES_TAG_NAME,
  CREATE_CLASSIC_TAG_ARIA_LABEL,
  DEFAULT_CLASSIC_TAG_NAME,
  DRAG_TYPE_NOTE,
  DRAG_TYPE_TAG,
  UNTAGGED_TAG_ID,
  UNTAGGED_TAG_NAME
} from '../lib/constants';
import { highlightText } from '../lib/highlightText';
import { ClassicContextMenu } from './ClassicContextMenu';
import type { TagContextMenuState, TagSidebarProps } from './tagSidebarState';
import { useTagSidebarState } from './tagSidebarState';

export function TagSidebar({
  tags,
  deletedTags = [],
  activeTagId,
  editingTagId,
  autoFocusSearch,
  totalNoteCount = 0,
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
  onRestoreTag,
  onTagNote,
  searchValue,
  onSearchChange,
  onSearchKeyDown,
  searchInputRef,
  contextMenuComponents
}: TagSidebarProps) {
  const { t } = useTranslation('classic');
  const {
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
  } = useTagSidebarState({
    tags,
    editingTagId,
    autoFocusSearch,
    onRenameTag,
    onCancelEditTag,
    searchInputRef
  });
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
    <aside
      className="flex w-64 flex-col border-r"
      aria-label={t('tagsSidebar')}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: div with role=button required for flexible layout container */}
      <div
        role="button"
        aria-label={t('tagListContextMenu')}
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
          {/* Virtual tags: All Items + Untagged Items */}
          <ul
            className="m-0 mb-2 list-none space-y-1 p-0"
            aria-label={t('virtualTags')}
          >
            <li
              className={`border px-2 py-0.5 ${activeTagId === null ? 'bg-accent' : 'bg-background'}`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="w-4 shrink-0 select-none text-center text-muted-foreground text-xs"
                >
                  📁
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-left text-sm"
                  onClick={() => onSelectTag(ALL_ENTRIES_TAG_ID)}
                  aria-pressed={activeTagId === null}
                  aria-label={`Select ${ALL_ENTRIES_TAG_NAME}`}
                >
                  <span className="text-foreground">
                    {t('allItems')} ({totalNoteCount})
                  </span>
                </button>
              </div>
            </li>
            <li
              className={`border px-2 py-0.5 ${activeTagId === UNTAGGED_TAG_ID ? 'bg-accent' : 'bg-background'}`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="w-4 shrink-0 select-none text-center text-muted-foreground text-xs"
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
                  <span className="text-foreground">
                    {UNTAGGED_TAG_NAME} ({untaggedCount})
                  </span>
                </button>
              </div>
            </li>
          </ul>
          {deletedTags.length > 0 && (
            <ul
              className="m-0 mb-2 list-none space-y-1 p-0"
              aria-label={t('deletedTags')}
            >
              <li className="px-2 py-0.5 text-muted-foreground text-xs uppercase tracking-wide">
                {t('deletedTags')} ({deletedTags.length})
              </li>
              {deletedTags.map((tag) => (
                <li key={tag.id} className="border bg-card px-2 py-0.5">
                  <div className="flex items-center gap-2">
                    <span className="w-4 shrink-0 select-none text-center text-muted-foreground text-xs">
                      🗑️
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
                      {tag.name}
                    </span>
                    <button
                      type="button"
                      className="rounded border border-border px-1.5 py-0.5 text-xs"
                      onClick={() => onRestoreTag?.(tag.id)}
                      aria-label={`${t('restoreTag')} ${tag.name}`}
                      disabled={onRestoreTag === undefined}
                    >
                      {t('restore')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {tags.length === 0 &&
            untaggedCount === 0 &&
            deletedTags.length === 0 &&
            onCreateTag && (
              <button
                type="button"
                onClick={() => void onCreateTag()}
                onContextMenu={(e) => e.preventDefault()}
                className="w-full border border-border border-dashed bg-card px-2 py-0.5 text-left hover:border-foreground/30 hover:bg-accent"
                aria-label={CREATE_CLASSIC_TAG_ARIA_LABEL}
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-center text-muted-foreground/50 text-xs">
                    ⋮⋮
                  </span>
                  <div className="min-w-0 flex-1 px-1.5 py-0.5">
                    <span className="block h-4 rounded bg-muted" />
                  </div>
                </div>
              </button>
            )}
          {tags.length === 0 &&
            untaggedCount === 0 &&
            deletedTags.length === 0 &&
            !onCreateTag && (
              // biome-ignore lint/a11y/noStaticElementInteractions: blocks context menu only
              <div
                className="w-full border border-border border-dashed bg-card px-2 py-0.5"
                onContextMenu={(e) => e.preventDefault()}
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-center text-muted-foreground/50 text-xs">
                    ⋮⋮
                  </span>
                  <div className="min-w-0 flex-1 px-1.5 py-0.5">
                    <span className="block h-4 rounded bg-muted" />
                  </div>
                </div>
              </div>
            )}
          {tags.length > 0 && (
            <ul
              className="m-0 list-none space-y-1 p-0"
              aria-label={t('tagList')}
            >
              {tags.map((tag, index) => {
                const isActive = tag.id === activeTagId;
                const canMoveUp = index > 0;
                const canMoveDown = index < tags.length - 1;
                return (
                  <li
                    key={tag.id}
                    className={`border px-2 py-0.5 ${dropTargetTagId === tag.id ? 'bg-primary/20' : isActive ? 'bg-accent' : 'bg-background'}`}
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
                            event.dataTransfer.getData('public.utf8-plain-text')
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
                          label: t('edit'),
                          onClick: () => onStartEditTag(tag.id),
                          ariaLabel: `${t('editTag')} ${tag.name}`
                        });
                      }
                      if (canMoveUp) {
                        actions.push({
                          label: t('moveUp'),
                          onClick: () => onMoveTag(tag.id, 'up'),
                          ariaLabel: `${t('moveUpTag')} ${tag.name} up`
                        });
                      }
                      if (canMoveDown) {
                        actions.push({
                          label: t('moveDown'),
                          onClick: () => onMoveTag(tag.id, 'down'),
                          ariaLabel: `${t('moveDownTag')} ${tag.name} down`
                        });
                      }
                      if (onDeleteTag) {
                        actions.push({
                          label: t('delete'),
                          onClick: () => onDeleteTag(tag.id),
                          ariaLabel: `${t('deleteTag')} ${tag.name}`
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
                            ? 'w-4 shrink-0 cursor-grabbing select-none text-center text-foreground text-xs'
                            : 'w-4 shrink-0 cursor-grab select-none text-center text-muted-foreground text-xs'
                        }
                        title={t('dragTag')}
                      >
                        ⋮⋮
                      </span>
                      {editingTagId === tag.id ? (
                        <div className="min-w-0 flex-1" data-tag-id={tag.id}>
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleEditKeyDown(e, tag.id)}
                            onBlur={() => handleEditBlur(tag.id)}
                            className="w-full border border-border px-1.5 py-0.5 text-base text-sm focus:border-ring focus:outline-none"
                            aria-label={`Edit tag ${tag.name}`}
                          />
                          <div className="mt-1 grid grid-cols-2 gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleSave(tag.id)}
                              className="border border-border px-1.5 py-0.5 text-foreground text-xs hover:border-ring focus:border-ring focus:outline-none"
                              aria-label={t('saveTagName')}
                            >
                              {t('save')}
                            </button>
                            <button
                              type="button"
                              onClick={handleCancel}
                              className="border border-border px-1.5 py-0.5 text-foreground text-xs hover:border-ring focus:border-ring focus:outline-none"
                              aria-label={t('cancelEditing')}
                            >
                              {t('cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-left text-sm"
                          onClick={() => onSelectTag(tag.id)}
                          aria-pressed={isActive}
                          aria-label={`Select tag ${tag.name}`}
                        >
                          <span className="text-foreground">
                            {highlightText(tag.name, searchValue)}
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
            className="box-border w-full border border-border px-2 py-1 text-sm focus:border-ring focus:outline-none"
            aria-label={t('searchTags')}
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
