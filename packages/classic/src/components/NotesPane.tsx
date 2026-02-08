import type { ClassicNote } from '../lib/types';

interface NotesPaneProps {
  activeTagName: string | null;
  noteIds: string[];
  notesById: Record<string, ClassicNote>;
  onMoveNote: (noteId: string, direction: 'up' | 'down') => void;
}

export function NotesPane({
  activeTagName,
  noteIds,
  notesById,
  onMoveNote
}: NotesPaneProps) {
  return (
    <section className="flex-1 p-4" aria-label="Notes Pane">
      <h2 className="mb-3 font-semibold text-lg">
        {activeTagName ? `Notes in ${activeTagName}` : 'Notes'}
      </h2>

      {!activeTagName ? (
        <p className="text-sm text-zinc-500">Select a tag to view notes.</p>
      ) : noteIds.length === 0 ? (
        <p className="text-sm text-zinc-500">No notes in this tag.</p>
      ) : (
        <ol className="space-y-2" aria-label="Note List">
          {noteIds.map((noteId, index) => {
            const note = notesById[noteId];
            if (!note) {
              return null;
            }
            return (
              <li key={note.id} className="rounded border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-medium text-sm">{note.title}</h3>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => onMoveNote(note.id, 'up')}
                      disabled={index === 0}
                      aria-label={`Move note ${note.title} up`}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => onMoveNote(note.id, 'down')}
                      disabled={index === noteIds.length - 1}
                      aria-label={`Move note ${note.title} down`}
                    >
                      Down
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-600">{note.body}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
