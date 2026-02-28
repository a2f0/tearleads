import { useTranslation } from 'react-i18next';
import {
  CREATE_CLASSIC_TAG_ARIA_LABEL,
  DEFAULT_CLASSIC_TAG_NAME
} from '../lib/constants';
import { ClassicContextMenu } from './ClassicContextMenu';
import { TagSidebarDeletedTags } from './tag-sidebar/TagSidebarDeletedTags';
import { TagSidebarEmptyState } from './tag-sidebar/TagSidebarEmptyState';
import { TagSidebarSearchInput } from './tag-sidebar/TagSidebarSearchInput';
import { TagSidebarTagItem } from './tag-sidebar/TagSidebarTagItem';
import { TagSidebarVirtualTags } from './tag-sidebar/TagSidebarVirtualTags';
import type { TagSidebarProps } from './tagSidebarState';
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

  const showEmptyState =
    tags.length === 0 && untaggedCount === 0 && deletedTags.length === 0;

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
          <TagSidebarVirtualTags
            activeTagId={activeTagId}
            totalNoteCount={totalNoteCount}
            untaggedCount={untaggedCount}
            onSelectTag={onSelectTag}
          />

          <TagSidebarDeletedTags
            deletedTags={deletedTags}
            onRestoreTag={onRestoreTag}
          />

          {showEmptyState && (
            <TagSidebarEmptyState
              canCreateTag={onCreateTag !== undefined}
              onCreateTag={onCreateTag}
            />
          )}

          {tags.length > 0 && (
            <ul
              className="m-0 list-none space-y-1 p-0"
              aria-label={t('tagList')}
            >
              {tags.map((tag, index) => (
                <TagSidebarTagItem
                  key={tag.id}
                  tag={tag}
                  activeTagId={activeTagId}
                  editingTagId={editingTagId}
                  searchValue={searchValue}
                  noteCountByTagId={noteCountByTagId}
                  canMoveUp={index > 0}
                  canMoveDown={index < tags.length - 1}
                  draggedTagId={draggedTagId}
                  dragArmedTagId={dragArmedTagId}
                  dropTargetTagId={dropTargetTagId}
                  lastHoverTagId={lastHoverTagId}
                  editInputRef={editInputRef}
                  editValue={editValue}
                  setEditValue={setEditValue}
                  setContextMenu={setContextMenu}
                  setDraggedTagId={setDraggedTagId}
                  setLastHoverTagId={setLastHoverTagId}
                  setDragArmedTagId={setDragArmedTagId}
                  setDropTargetTagId={setDropTargetTagId}
                  handleEditKeyDown={handleEditKeyDown}
                  handleEditBlur={handleEditBlur}
                  handleSave={handleSave}
                  handleCancel={handleCancel}
                  onSelectTag={onSelectTag}
                  onMoveTag={onMoveTag}
                  onReorderTag={onReorderTag}
                  onStartEditTag={onStartEditTag}
                  onDeleteTag={onDeleteTag}
                  onTagNote={onTagNote}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="py-3">
        <div className="pr-2">
          <TagSidebarSearchInput
            searchInputRef={effectiveSearchInputRef}
            searchValue={searchValue}
            onSearchChange={onSearchChange}
            onSearchKeyDown={onSearchKeyDown}
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
