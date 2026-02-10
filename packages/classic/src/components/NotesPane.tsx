import { useEffect, useRef, useState } from 'react';
import {
  CREATE_CLASSIC_NOTE_ARIA_LABEL,
  DEFAULT_CLASSIC_NOTE_TITLE,
  DRAG_TYPE_NOTE,
  DRAG_TYPE_TAG
} from '../lib/constants';
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
  activeTagName,
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
  contextMenuComponents
}: NotesPaneProps) {
  const [contextMenu, setContextMenu] = useState<NotesContextMenuState | null>(
    null
  );
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [lastHoverNoteId, setLastHoverNoteId] = useState<string | null>(null);
  const [dragArmedNoteId, setDragArmedNoteId] = useState<string | null>(null);
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

  return (
    <section className="flex flex-1 flex-col" aria-label="Notes Pane">
      {/* biome-ignore lint/a11y/useSemanticElements: div with role=button required for flexible layout container */}
      <div
        role="button"
        aria-label="Entry list, press Shift+F10 for context menu"
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
        {!activeTagName ? (
          <p className="text-sm text-zinc-500">Select a tag to view notes.</p>
        ) : noteIds.length === 0 ? (
          <p className="text-sm text-zinc-500">No entries in this tag.</p>
        ) : (
          <ol className="space-y-2" aria-label="Note List">
            {visibleNotes.map((note, index) => {
              const canMoveUp = index > 0;
              const canMoveDown = index < visibleNotes.length - 1;
              return (
                <li
                  key={note.id}
                  className="rounded p-3"
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
                  }}
                  onDragOver={(event) => {
                    const types = event.dataTransfer?.types ?? [];
                    const hasTag = types.includes(DRAG_TYPE_TAG);
                    if (hasTag && onTagNote) {
                      event.preventDefault();
                      return;
                    }
                    if (!draggedNoteId || draggedNoteId === note.id) {
                      return;
                    }
                    event.preventDefault();
                    if (lastHoverNoteId === note.id) {
                      return;
                    }
                    onReorderNote(draggedNoteId, note.id);
                    setLastHoverNoteId(note.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragArmedNoteId(null);
                    const tagId = event.dataTransfer.getData(DRAG_TYPE_TAG);
                    if (tagId && onTagNote) {
                      onTagNote(tagId, note.id);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const actions: NotesContextMenuState['actions'] = [];
                    if (onStartEditNote) {
                      actions.push({
                        label: 'Edit',
                        onClick: () => onStartEditNote(note.id),
                        ariaLabel: `Edit note ${note.title}`
                      });
                    }
                    if (canMoveUp) {
                      actions.push({
                        label: 'Move Up',
                        onClick: () => onMoveNote(note.id, 'up'),
                        ariaLabel: `Move note ${note.title} up`
                      });
                    }
                    if (canMoveDown) {
                      actions.push({
                        label: 'Move Down',
                        onClick: () => onMoveNote(note.id, 'down'),
                        ariaLabel: `Move note ${note.title} down`
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
                      title="Drag entry"
                    >
                      <span
                        className={
                          draggedNoteId === note.id
                            ? 'cursor-grabbing select-none text-center text-xs text-zinc-500'
                            : 'cursor-grab select-none text-center text-xs text-zinc-400'
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
                          className="w-full border border-zinc-300 px-1.5 py-0.5 text-base text-sm focus:border-zinc-500 focus:outline-none"
                          aria-label="Edit entry title"
                        />
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          onKeyDown={(e) => handleEditKeyDown(e, note.id)}
                          onBlur={() => handleEditBlur(note.id)}
                          className="w-full border border-zinc-300 px-1.5 py-0.5 font-mono text-base text-xs focus:border-zinc-500 focus:outline-none"
                          rows={2}
                          aria-label="Edit entry body"
                        />
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <h3 className="text-sm">{note.title}</h3>
                        <p className="font-mono text-xs text-zinc-600">
                          {note.body}
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
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-64 border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none"
          aria-label="Search entries"
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
