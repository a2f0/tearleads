import { useState } from 'react';
import type { ClassicNote } from '../lib/types';
import { ClassicContextMenu } from './ClassicContextMenu';

interface NotesPaneProps {
  activeTagName: string | null;
  noteIds: string[];
  notesById: Record<string, ClassicNote>;
  onMoveNote: (noteId: string, direction: 'up' | 'down') => void;
  onReorderNote: (noteId: string, targetNoteId: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
}

interface NotesContextMenuState {
  x: number;
  y: number;
  noteId: string;
  noteTitle: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function NotesPane({
  activeTagName,
  noteIds,
  notesById,
  onMoveNote,
  onReorderNote,
  searchValue,
  onSearchChange
}: NotesPaneProps) {
  const [contextMenu, setContextMenu] = useState<NotesContextMenuState | null>(
    null
  );
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [lastHoverNoteId, setLastHoverNoteId] = useState<string | null>(null);
  const [dragArmedNoteId, setDragArmedNoteId] = useState<string | null>(null);

  const closeContextMenu = () => setContextMenu(null);

  const visibleNotes = noteIds
    .map((noteId) => notesById[noteId])
    .filter((note): note is ClassicNote => Boolean(note));

  return (
    <section className="flex flex-1 flex-col" aria-label="Notes Pane">
      <div className="flex-1 overflow-auto p-4">
        {!activeTagName ? (
          <p className="text-sm text-zinc-500">Select a tag to view notes.</p>
        ) : noteIds.length === 0 ? (
          <p className="text-sm text-zinc-500">No notes in this tag.</p>
        ) : (
          <ol className="space-y-2" aria-label="Note List">
            {visibleNotes.map((note, index) => {
              const canMoveUp = index > 0;
              const canMoveDown = index < visibleNotes.length - 1;
              return (
                <li
                  key={note.id}
                  className="rounded border p-3"
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
                  }}
                  onDragEnd={() => {
                    setDraggedNoteId(null);
                    setLastHoverNoteId(null);
                    setDragArmedNoteId(null);
                  }}
                  onDragOver={(event) => {
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
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      noteId: note.id,
                      noteTitle: note.title,
                      canMoveUp,
                      canMoveDown
                    });
                  }}
                >
                  <div className="flex items-stretch gap-2">
                    <div
                      aria-hidden="true"
                      data-drag-handle="true"
                      onMouseDown={() => setDragArmedNoteId(note.id)}
                      onMouseUp={() => setDragArmedNoteId(null)}
                      className="flex w-4 shrink-0 items-center justify-center"
                      title="Drag entry"
                    >
                      <span
                        className={
                          draggedNoteId === note.id
                            ? 'cursor-grabbing select-none text-center text-zinc-500 text-xs'
                            : 'cursor-grab select-none text-center text-zinc-400 text-xs'
                        }
                      >
                        ⋮⋮
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm">{note.title}</h3>
                      <p className="text-xs text-zinc-600">{note.body}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="p-4">
        <input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search entries..."
          className="w-64 rounded border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none"
          aria-label="Search entries"
        />
      </div>
      {contextMenu && (
        <ClassicContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel={`Note actions for ${contextMenu.noteTitle}`}
          onClose={closeContextMenu}
          actions={[
            {
              label: 'Move Up',
              onClick: () => onMoveNote(contextMenu.noteId, 'up'),
              disabled: !contextMenu.canMoveUp,
              ariaLabel: `Move note ${contextMenu.noteTitle} up`
            },
            {
              label: 'Move Down',
              onClick: () => onMoveNote(contextMenu.noteId, 'down'),
              disabled: !contextMenu.canMoveDown,
              ariaLabel: `Move note ${contextMenu.noteTitle} down`
            }
          ]}
        />
      )}
    </section>
  );
}
