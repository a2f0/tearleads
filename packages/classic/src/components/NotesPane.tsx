import { useState } from 'react';
import type { ClassicNote } from '../lib/types';
import {
  ClassicContextMenu,
  type ClassicContextMenuComponents
} from './ClassicContextMenu';

interface NotesPaneProps {
  activeTagName: string | null;
  noteIds: string[];
  notesById: Record<string, ClassicNote>;
  onMoveNote: (noteId: string, direction: 'up' | 'down') => void;
  onReorderNote: (noteId: string, targetNoteId: string) => void;
  onCreateNote?: (() => void | Promise<void>) | undefined;
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
  onMoveNote,
  onReorderNote,
  onCreateNote,
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

  const closeContextMenu = () => setContextMenu(null);

  const visibleNotes = noteIds
    .map((noteId) => notesById[noteId])
    .filter((note): note is ClassicNote => Boolean(note));

  return (
    <section className="flex flex-1 flex-col" aria-label="Notes Pane">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty space */}
      <div
        className="flex-1 overflow-auto p-4"
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            ariaLabel: 'Entry list actions',
            actions: [
              {
                label: 'New Entry',
                onClick: () => {
                  void onCreateNote?.();
                },
                ariaLabel: 'Create new entry',
                disabled: onCreateNote === undefined
              }
            ]
          });
        }}
      >
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
                    event.stopPropagation();
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      ariaLabel: `Note actions for ${note.title}`,
                      actions: [
                        {
                          label: 'Move Up',
                          onClick: () => onMoveNote(note.id, 'up'),
                          disabled: !canMoveUp,
                          ariaLabel: `Move note ${note.title} up`
                        },
                        {
                          label: 'Move Down',
                          onClick: () => onMoveNote(note.id, 'down'),
                          disabled: !canMoveDown,
                          ariaLabel: `Move note ${note.title} down`
                        }
                      ]
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
                            ? 'cursor-grabbing select-none text-center text-xs text-zinc-500'
                            : 'cursor-grab select-none text-center text-xs text-zinc-400'
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
          className="w-64 rounded border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none"
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
