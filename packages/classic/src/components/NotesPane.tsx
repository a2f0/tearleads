import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CREATE_CLASSIC_NOTE_ARIA_LABEL,
  DEFAULT_CLASSIC_NOTE_TITLE,
  DRAG_TYPE_NOTE,
  DRAG_TYPE_TAG
} from '../lib/constants';
import { highlightText } from '../lib/highlightText';
import type { ClassicNote } from '../lib/types';
import {
  ClassicContextMenu,
  type ClassicContextMenuComponents
} from './ClassicContextMenu';

interface NotesPaneProps {
  activeTagName: string | null;
  noteIds: string[];
  notesById: Record<string, ClassicNote>;
  editingNoteId?: string | null;
  onMoveNote: (noteId: string, direction: 'up' | 'down') => void;
  onReorderNote: (noteId: string, targetNoteId: string) => void;
  onCreateNote?: (() => void | Promise<void>) | undefined;
  onStartEditNote?: (noteId: string) => void;
  onUpdateNote?: (noteId: string, title: string, body: string) => void;
  onCancelEditNote?: () => void;
  onTagNote?: (tagId: string, noteId: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  contextMenuComponents?: ClassicContextMenuComponents | undefined;
}

interface NotesContextMenuState {
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

export function NotesPane({
  activeTagName: _activeTagName,
  noteIds,
  notesById,
  editingNoteId,
  onMoveNote,
  onReorderNote,
  onCreateNote,
  onStartEditNote,
  onUpdateNote,
  onCancelEditNote,
  onTagNote,
  searchValue,
  onSearchChange,
  onSearchKeyDown,
  searchInputRef,
  contextMenuComponents
}: NotesPaneProps) {
  const { t } = useTranslation('classic');
  const [contextMenu, setContextMenu] = useState<NotesContextMenuState | null>(
    null
  );
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [lastHoverNoteId, setLastHoverNoteId] = useState<string | null>(null);
  const [dragArmedNoteId, setDragArmedNoteId] = useState<string | null>(null);
  const [dropTargetNoteId, setDropTargetNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const editTitleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingNoteId) {
      const note = notesById[editingNoteId];
      setEditTitle(note?.title ?? '');
      setEditBody(note?.body ?? '');
      setTimeout(() => {
        editTitleRef.current?.focus();
        editTitleRef.current?.select();
      }, 0);
    }
  }, [editingNoteId, notesById]);

  const closeContextMenu = () => setContextMenu(null);

  const commitOrCancelEdit = (noteId: string) => {
    if (editTitle.trim() && onUpdateNote) {
      onUpdateNote(noteId, editTitle.trim(), editBody);
    } else {
      onCancelEditNote?.();
    }
  };

  const handleEditKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    noteId: string
  ) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commitOrCancelEdit(noteId);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancelEditNote?.();
    }
  };

  const handleEditBlur = (noteId: string) => {
    setTimeout(() => {
      const activeElement = document.activeElement;
      const isStillEditing =
        activeElement === editTitleRef.current ||
        activeElement?.closest(`[data-note-id="${noteId}"]`);
      if (!isStillEditing) {
        commitOrCancelEdit(noteId);
      }
    }, 0);
  };

  const handleSave = (noteId: string) => {
    if (editTitle.trim() && onUpdateNote) {
      onUpdateNote(noteId, editTitle.trim(), editBody);
    } else {
      onCancelEditNote?.();
    }
  };

  const handleCancel = () => {
    onCancelEditNote?.();
  };

  const openEmptySpaceContextMenu = (x: number, y: number) => {
    setContextMenu({
      x,
      y,
      ariaLabel: 'Entry list actions',
      actions: [
        {
          label: DEFAULT_CLASSIC_NOTE_TITLE,
          onClick: () => {
            void onCreateNote?.();
          },
          ariaLabel: CREATE_CLASSIC_NOTE_ARIA_LABEL,
          disabled: onCreateNote === undefined
        }
      ]
    });
  };

  const visibleNotes = noteIds
    .map((noteId) => notesById[noteId])
    .filter((note): note is ClassicNote => Boolean(note));

  const isTagDrag = (
    dataTransfer: DataTransfer | null | undefined
  ): boolean => {
    if (!dataTransfer) {
      return false;
    }
    const types = dataTransfer.types ?? [];
    const hasTag = types.includes(DRAG_TYPE_TAG);
    const hasPlainText = types.includes('text/plain');
    const hasSafariPlainText = types.includes('public.utf8-plain-text');
    const hasExternalClassicTagDrag =
      (hasPlainText || hasSafariPlainText) && draggedNoteId === null;
    return hasTag || hasExternalClassicTagDrag;
  };

  return (
    <section className="flex flex-1 flex-col" aria-label={t('notesPane')}>
      {/* biome-ignore lint/a11y/useSemanticElements: div with role=button required for flexible layout container */}
      <div
        role="button"
        aria-label={t('entryListContextMenu')}
        tabIndex={0}
        className="flex-1 overflow-auto p-3 focus:outline-none"
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
        {noteIds.length === 0 && onCreateNote ? (
          <button
            type="button"
            onClick={() => void onCreateNote()}
            onContextMenu={(e) => e.preventDefault()}
            className="w-full rounded border border-border border-dashed bg-card p-3 text-left hover:border-foreground/30 hover:bg-accent"
            aria-label={CREATE_CLASSIC_NOTE_ARIA_LABEL}
          >
            <div className="flex items-start gap-2">
              <span className="w-4 shrink-0 pt-1 text-center text-xs text-muted-foreground/50">
                ⋮⋮
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <span className="block h-4 w-2/3 rounded bg-muted" />
                <span className="block h-3 w-full rounded bg-muted" />
              </div>
            </div>
          </button>
        ) : noteIds.length === 0 ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: blocks context menu only
          <div
            className="rounded border border-border border-dashed bg-card p-3"
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="flex items-start gap-2">
              <span className="w-4 shrink-0 pt-1 text-center text-xs text-muted-foreground/50">
                ⋮⋮
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <span className="block h-4 w-2/3 rounded bg-muted" />
                <span className="block h-3 w-full rounded bg-muted" />
              </div>
            </div>
          </div>
        ) : (
          <ol className="space-y-2" aria-label={t('noteList')}>
            {visibleNotes.map((note, index) => {
              const canMoveUp = index > 0;
              const canMoveDown = index < visibleNotes.length - 1;
              return (
                <li
                  key={note.id}
                  className={
                    dropTargetNoteId === note.id
                      ? 'rounded bg-primary/20 p-3'
                      : 'rounded p-3'
                  }
                  draggable
                  onDragStart={(event) => {
                    const target = event.target;
                    if (
                      dragArmedNoteId !== note.id &&
                      (!(target instanceof HTMLElement) ||
                        !target.closest('[data-drag-handle="true"]'))
                    ) {
                      event.preventDefault();
                      return;
                    }
                    setDraggedNoteId(note.id);
                    setLastHoverNoteId(null);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', note.id);
                    event.dataTransfer.setData(DRAG_TYPE_NOTE, note.id);
                  }}
                  onDragEnd={() => {
                    setDraggedNoteId(null);
                    setLastHoverNoteId(null);
                    setDragArmedNoteId(null);
                    setDropTargetNoteId(null);
                  }}
                  onDragOver={(event) => {
                    if (isTagDrag(event.dataTransfer) && onTagNote) {
                      event.preventDefault();
                      if (dropTargetNoteId !== note.id) {
                        setDropTargetNoteId(note.id);
                      }
                      return;
                    }
                    if (dropTargetNoteId === note.id) {
                      setDropTargetNoteId(null);
                    }
                    if (!draggedNoteId || draggedNoteId === note.id) {
                      return;
                    }
                    event.preventDefault();
                    if (event.dataTransfer) {
                      event.dataTransfer.dropEffect = 'move';
                    }
                    if (lastHoverNoteId === note.id) {
                      return;
                    }
                    onReorderNote(draggedNoteId, note.id);
                    setLastHoverNoteId(note.id);
                  }}
                  onDragEnter={(event) => {
                    if (
                      isTagDrag(event.dataTransfer) &&
                      onTagNote &&
                      dropTargetNoteId !== note.id
                    ) {
                      setDropTargetNoteId(note.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragArmedNoteId(null);
                    setDropTargetNoteId(null);
                    const customTagId =
                      event.dataTransfer.getData(DRAG_TYPE_TAG);
                    const fallbackTagId =
                      draggedNoteId === null
                        ? event.dataTransfer.getData('text/plain') ||
                          event.dataTransfer.getData('public.utf8-plain-text')
                        : '';
                    const tagId = customTagId || fallbackTagId;
                    if (tagId && onTagNote) {
                      onTagNote(tagId, note.id);
                    }
                  }}
                  onDragLeave={() => {
                    if (dropTargetNoteId === note.id) {
                      setDropTargetNoteId(null);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const actions: NotesContextMenuState['actions'] = [];
                    if (onStartEditNote) {
                      actions.push({
                        label: t('edit'),
                        onClick: () => onStartEditNote(note.id),
                        ariaLabel: `${t('editNote')} ${note.title}`
                      });
                    }
                    if (canMoveUp) {
                      actions.push({
                        label: t('moveUp'),
                        onClick: () => onMoveNote(note.id, 'up'),
                        ariaLabel: `${t('moveUpNote')} ${note.title} up`
                      });
                    }
                    if (canMoveDown) {
                      actions.push({
                        label: t('moveDown'),
                        onClick: () => onMoveNote(note.id, 'down'),
                        ariaLabel: `${t('moveDownNote')} ${note.title} down`
                      });
                    }
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      ariaLabel: `Note actions for ${note.title}`,
                      actions
                    });
                  }}
                >
                  <div
                    className="flex items-stretch gap-2"
                    data-note-id={note.id}
                  >
                    <div
                      aria-hidden="true"
                      data-drag-handle="true"
                      onMouseDown={() => setDragArmedNoteId(note.id)}
                      onMouseUp={() => setDragArmedNoteId(null)}
                      className="flex w-4 shrink-0 items-start justify-center pt-1"
                      title={t('dragEntry')}
                    >
                      <span
                        className={
                          draggedNoteId === note.id
                            ? 'cursor-grabbing select-none text-center text-xs text-foreground'
                            : 'cursor-grab select-none text-center text-xs text-muted-foreground'
                        }
                      >
                        ⋮⋮
                      </span>
                    </div>
                    {editingNoteId === note.id ? (
                      <div className="min-w-0 flex-1 space-y-1">
                        <input
                          ref={editTitleRef}
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => handleEditKeyDown(e, note.id)}
                          onBlur={() => handleEditBlur(note.id)}
                          className="w-full border border-border px-1.5 py-0.5 text-base text-sm focus:border-ring focus:outline-none"
                          aria-label={t('editEntryTitle')}
                        />
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          onKeyDown={(e) => handleEditKeyDown(e, note.id)}
                          onBlur={() => handleEditBlur(note.id)}
                          className="w-full border border-border px-1.5 py-0.5 font-mono text-base text-xs focus:border-ring focus:outline-none"
                          rows={2}
                          aria-label={t('editEntryBody')}
                        />
                        <div className="grid grid-cols-2 gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleSave(note.id)}
                            className="border border-border px-1.5 py-0.5 text-xs text-foreground hover:border-ring focus:border-ring focus:outline-none"
                            aria-label={t('saveEntry')}
                          >
                            {t('save')}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancel}
                            className="border border-border px-1.5 py-0.5 text-xs text-foreground hover:border-ring focus:border-ring focus:outline-none"
                            aria-label={t('cancelEditing')}
                          >
                            {t('cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <h3 className="text-sm">
                          {highlightText(note.title, searchValue)}
                        </h3>
                        <p className="font-mono text-xs text-muted-foreground">
                          {highlightText(note.body, searchValue)}
                        </p>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="p-3">
        <input
          ref={searchInputRef}
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          className="w-64 border border-border px-2 py-1 text-sm focus:border-ring focus:outline-none"
          aria-label={t('searchEntries')}
        />
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
    </section>
  );
}
