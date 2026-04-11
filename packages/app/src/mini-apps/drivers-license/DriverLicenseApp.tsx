import { DEFAULT_NOTE_ID, NotesProvider } from "../notes/NotesProvider";
import type { NoteSummary } from "../notes/notesPersistence";
import { DriverLicense } from "./DriverLicense";

interface DriverLicenseAppProps {
  containerId?: string | null;
  documentId?: string | null;
  noteId?: string;
  onPersistedNote?: (note: NoteSummary) => void;
}

export function DriverLicenseApp({
  containerId,
  documentId,
  noteId = DEFAULT_NOTE_ID,
  onPersistedNote,
}: DriverLicenseAppProps) {
  return (
    <NotesProvider
      noteId={noteId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      {...(onPersistedNote === undefined ? {} : { onPersistedNote })}
    >
      <DriverLicense />
    </NotesProvider>
  );
}
