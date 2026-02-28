import { useTranslation } from 'react-i18next';
import { DRAG_TYPE_NOTE, DRAG_TYPE_TAG } from '../../lib/constants';
import { highlightText } from '../../lib/highlightText';
import type { ClassicTag } from '../../lib/types';
import type { TagContextMenuState } from '../tagSidebarState';

interface TagSidebarTagItemDndProps {
  draggedTagId: string | null;
  dragArmedTagId: string | null;
  dropTargetTagId: string | null;
  lastHoverTagId: string | null;
  setDraggedTagId: (tagId: string | null) => void;
  setLastHoverTagId: (tagId: string | null) => void;
  setDragArmedTagId: (tagId: string | null) => void;
  setDropTargetTagId: (tagId: string | null) => void;
}

interface TagSidebarTagItemEditingProps {
  editingTagId?: string | null | undefined;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  editValue: string;
  setEditValue: (value: string) => void;
  handleEditKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
    tagId: string
  ) => void;
  handleEditBlur: (tagId: string) => void;
  handleSave: (tagId: string) => void;
  handleCancel: () => void;
}

interface TagSidebarTagItemActionProps {
  onSelectTag: (tagId: string) => void;
  onMoveTag: (tagId: string, direction: 'up' | 'down') => void;
  onReorderTag: (tagId: string, targetTagId: string) => void;
  onStartEditTag?: ((tagId: string) => void) | undefined;
  onDeleteTag?: ((tagId: string) => void) | undefined;
  onTagNote?: ((tagId: string, noteId: string) => void) | undefined;
}

interface TagSidebarTagItemProps {
  tag: ClassicTag;
  activeTagId: string | null;
  searchValue: string;
  noteCountByTagId: Record<string, number>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dnd: TagSidebarTagItemDndProps;
  editing: TagSidebarTagItemEditingProps;
  actions: TagSidebarTagItemActionProps;
  setContextMenu: React.Dispatch<
    React.SetStateAction<TagContextMenuState | null>
  >;
}

export function TagSidebarTagItem({
  tag,
  activeTagId,
  searchValue,
  noteCountByTagId,
  canMoveUp,
  canMoveDown,
  dnd,
  editing,
  actions,
  setContextMenu
}: TagSidebarTagItemProps) {
  const { t } = useTranslation('classic');
  const isActive = tag.id === activeTagId;
  const {
    draggedTagId,
    dragArmedTagId,
    dropTargetTagId,
    lastHoverTagId,
    setDraggedTagId,
    setLastHoverTagId,
    setDragArmedTagId,
    setDropTargetTagId
  } = dnd;
  const {
    editingTagId,
    editInputRef,
    editValue,
    setEditValue,
    handleEditKeyDown,
    handleEditBlur,
    handleSave,
    handleCancel
  } = editing;
  const {
    onSelectTag,
    onMoveTag,
    onReorderTag,
    onStartEditTag,
    onDeleteTag,
    onTagNote
  } = actions;

  return (
    <li
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
        const hasSafariPlainText = types.includes('public.utf8-plain-text');
        const hasExternalClassicNoteDrag =
          (hasPlainText || hasSafariPlainText) && draggedTagId === null;
        if ((hasNote || hasExternalClassicNoteDrag) && onTagNote) {
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
        const hasSafariPlainText = types.includes('public.utf8-plain-text');
        const hasExternalClassicNoteDrag =
          (hasPlainText || hasSafariPlainText) && draggedTagId === null;
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
        const customNoteId = event.dataTransfer.getData(DRAG_TYPE_NOTE);
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
              onChange={(event) => setEditValue(event.target.value)}
              onKeyDown={(event) => handleEditKeyDown(event, tag.id)}
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
}
