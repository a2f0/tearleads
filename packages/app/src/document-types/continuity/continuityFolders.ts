import type { SeedDocument } from "./seedDocuments";
import type { SeedFolderAccess, SeedNoteAddition, SeedSpec } from "./seedTypes";

export interface ContinuityFolderNote {
  /** The owner's note, written like any other fixture. */
  readonly document: SeedDocument;
  /** Lines group members append as themselves, in order. */
  readonly additions: readonly SeedNoteAddition[];
}

export interface ContinuityFolder {
  readonly name: string;
  readonly grants: readonly {
    readonly group: string;
    readonly access: SeedFolderAccess;
  }[];
  readonly notes: readonly ContinuityFolderNote[];
}

/** The dataset's folders, each note keyed by its folder and position. */
export function continuityFolders(spec: SeedSpec): ContinuityFolder[] {
  return (spec.folders ?? []).map((folder, folderIndex) => ({
    name: folder.name,
    grants: folder.grants ?? [],
    notes: (folder.notes ?? []).map((note, noteIndex) => ({
      document: {
        key: `folder/${folderIndex}/note/${noteIndex}`,
        kind: "note",
        text: note.text,
        attachments: [],
      },
      additions: note.additions ?? [],
    })),
  }));
}

function containsLines(text: string, lines: readonly string[]): boolean {
  const existing = text.split("\n");
  return existing.some((_, start) =>
    lines.every((line, offset) => existing[start + offset] === line),
  );
}

/**
 * The note's text with `addition` appended on its own line, or null when its
 * lines are already in the note, so a rerun adds nothing twice and keeps
 * whatever else the note became.
 */
export function appendNoteAddition(
  text: string,
  addition: string,
): string | null {
  if (containsLines(text, addition.split("\n"))) return null;
  if (text.length === 0 || text.endsWith("\n")) return `${text}${addition}`;
  return `${text}\n${addition}`;
}
