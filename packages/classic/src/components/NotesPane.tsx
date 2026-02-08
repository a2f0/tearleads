import { useState } from 'react';
import type { ClassicNote } from '../lib/types';
import { ClassicContextMenu } from './ClassicContextMenu';

interface NotesPaneProps {
  activeTagName: string | null;
  noteIds: string[];
  notesById: Record<string, ClassicNote>;
  onMoveNote: (noteId: string, direction: 'up' | 'down') => void;
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
  searchValue,
  onSearchChange
}: NotesPaneProps) {
  const [contextMenu, setContextMenu] = useState<NotesContextMenuState | null>(
    null
  );

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
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="min-w-0 flex-1 text-sm">{note.title}</h3>
                    <div className="flex items-center gap-1">
                      <span
                        aria-hidden="true"
                        className="select-none text-zinc-400 text-xs"
                        title="Move entry"
                      >
                        ⋮⋮
                      </span>
                      <button
                        type="button"
                        className="rounded border border-zinc-200 px-1 py-0 text-xs text-zinc-600 disabled:opacity-40"
                        onClick={() => onMoveNote(note.id, 'up')}
                        disabled={!canMoveUp}
                        aria-label={`Move note ${note.title} up via handle`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rounded border border-zinc-200 px-1 py-0 text-xs text-zinc-600 disabled:opacity-40"
                        onClick={() => onMoveNote(note.id, 'down')}
                        disabled={!canMoveDown}
                        aria-label={`Move note ${note.title} down via handle`}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-600">{note.body}</p>
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
