import { StickyNote } from 'lucide-react';
import type { NoteInfo } from '../../context/NotesContext';
import { formatDate } from '../../lib/utils';
import { getContentPreview } from './getContentPreview';

interface NoteItemContentProps {
  note: NoteInfo;
}

export function NoteItemContent({ note }: NoteItemContentProps) {
  return (
    <>
      <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate font-medium text-xs ${note.deleted ? 'line-through' : ''}`}
        >
          {note.title}
        </p>
        <p className="truncate text-muted-foreground text-xs">
          {getContentPreview(note.content)} · {formatDate(note.updatedAt)}
          {note.deleted && ' · Deleted'}
        </p>
      </div>
    </>
  );
}
