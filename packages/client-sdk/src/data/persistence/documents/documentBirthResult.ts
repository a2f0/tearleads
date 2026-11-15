/** A birth timestamp, an existing local row, or a refused remote alias. */
export type DocumentBirthResult =
  | string
  | null
  | { status: "remote-alias"; documentId: string; localId: string };
