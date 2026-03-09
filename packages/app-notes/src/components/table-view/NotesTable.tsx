import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { StickyNote } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { NoteInfo } from '../../context/NotesContext';
import { formatDate } from '../../lib/utils';
import { type SortColumn, type SortDirection, SortHeader } from './SortHeader';

interface NotesTableProps {
  notesList: NoteInfo[];
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSortChange: (column: SortColumn) => void;
  onSelectNote: (noteId: string) => void;
  onNoteContextMenu: (e: MouseEvent, note: NoteInfo) => void;
  onBlankSpaceContextMenu: (e: MouseEvent) => void;
}

export function NotesTable({
  notesList,
  sortColumn,
  sortDirection,
  onSortChange,
  onSelectNote,
  onNoteContextMenu,
  onBlankSpaceContextMenu
}: NotesTableProps) {
  return (
    <div
      role="application"
      className="flex-1 overflow-auto rounded-lg border [border-color:var(--soft-border)]"
      onContextMenu={onBlankSpaceContextMenu}
    >
      <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
        <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
          <tr>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <SortHeader
                column="title"
                label="Title"
                currentColumn={sortColumn}
                direction={sortDirection}
                onClick={onSortChange}
              />
            </th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <SortHeader
                column="createdAt"
                label="Created"
                currentColumn={sortColumn}
                direction={sortDirection}
                onClick={onSortChange}
              />
            </th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <SortHeader
                column="updatedAt"
                label="Updated"
                currentColumn={sortColumn}
                direction={sortDirection}
                onClick={onSortChange}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {notesList.map((note) => (
            <WindowTableRow
              key={note.id}
              isDimmed={note.deleted}
              className={
                note.deleted ? 'cursor-default hover:bg-transparent' : undefined
              }
              onClick={() => {
                if (!note.deleted) {
                  onSelectNote(note.id);
                }
              }}
              onContextMenu={
                note.deleted
                  ? undefined
                  : (e: MouseEvent) => onNoteContextMenu(e, note)
              }
            >
              <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                <div className="flex items-center gap-1.5">
                  <StickyNote className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span
                    className={`truncate ${note.deleted ? 'line-through' : ''}`}
                  >
                    {note.title}
                  </span>
                </div>
              </td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                {formatDate(note.createdAt)}
              </td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                {formatDate(note.updatedAt)}
                {note.deleted && ' · Deleted'}
              </td>
            </WindowTableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
