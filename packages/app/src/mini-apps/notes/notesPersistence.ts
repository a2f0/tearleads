import type * as DocumentPersistence from "../../data/documents/documentsPersistence";
import {
  listDocumentsByContainerIds,
  sqlDocumentsPersistence,
} from "../../data/documents/documentsPersistence";
import type { ExecSql } from "../../data/persistence/sqlSchema";

export interface NoteRecord extends DocumentPersistence.StoredDocumentRecord {}

export interface NoteSummary extends DocumentPersistence.DocumentSummary {}

export interface PendingUpdateInsert {
  noteId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  sourceVersionVector?: string | null;
  updateData: string;
}

export interface PendingUpdateRecord
  extends DocumentPersistence.PendingUpdateRecord {}

export interface PendingAttachmentRecord
  extends Omit<DocumentPersistence.PendingAttachmentRecord, "localId"> {
  noteId: string;
}

export interface PendingAttachmentRewrapRecord
  extends Omit<DocumentPersistence.PendingAttachmentRewrapRecord, "localId"> {
  noteId: string;
}

export interface PendingAttachmentReplacementRecord
  extends Omit<
    DocumentPersistence.PendingAttachmentReplacementRecord,
    "localId"
  > {
  noteId: string;
}

export interface LocalAttachmentRecord
  extends Omit<DocumentPersistence.LocalAttachmentRecord, "localId"> {
  noteId: string;
}

export interface DiscoveredNoteInput
  extends DocumentPersistence.DiscoveredDocumentInput {}

export interface RelinkPersistedNoteInput
  extends Omit<DocumentPersistence.RelinkPersistedDocumentInput, "localId"> {
  noteId: string;
}

export interface NotesPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  listNotes: (execSql: ExecSql) => Promise<NoteSummary[]>;
  listNotesByContainerIdsOrDocumentIds: (
    execSql: ExecSql,
    input: {
      containerIds: ReadonlyArray<string>;
      documentIds: ReadonlyArray<string>;
    },
  ) => Promise<NoteSummary[]>;
  loadNote: (execSql: ExecSql, noteId: string) => Promise<NoteRecord | null>;
  saveNote: (
    execSql: ExecSql,
    note: NoteRecord,
    options?: {
      updatedAt?: string;
    },
  ) => Promise<string>;
  upsertDiscoveredNote: (
    execSql: ExecSql,
    input: DiscoveredNoteInput,
  ) => Promise<NoteSummary>;
  relinkPersistedNote: (
    execSql: ExecSql,
    input: RelinkPersistedNoteInput,
  ) => Promise<NoteSummary | null>;
  listPendingUpdates: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingUpdateRecord[]>;
  listPendingAttachments: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingAttachmentRecord[]>;
  listPendingAttachmentRewraps: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingAttachmentRewrapRecord[]>;
  listPendingAttachmentReplacements: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingAttachmentReplacementRecord[]>;
  listLocalAttachments: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<LocalAttachmentRecord[]>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: PendingUpdateInsert,
  ) => Promise<void>;
  saveLocalAttachment: (
    execSql: ExecSql,
    attachment: LocalAttachmentRecord,
  ) => Promise<void>;
  savePendingAttachment: (
    execSql: ExecSql,
    attachment: PendingAttachmentRecord,
  ) => Promise<void>;
  savePendingAttachmentRewrap: (
    execSql: ExecSql,
    attachment: PendingAttachmentRewrapRecord,
  ) => Promise<void>;
  savePendingAttachmentReplacement: (
    execSql: ExecSql,
    attachment: PendingAttachmentReplacementRecord,
  ) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
  deletePendingUpdates: (execSql: ExecSql, noteId: string) => Promise<void>;
  deletePendingAttachment: (
    execSql: ExecSql,
    noteId: string,
    slotId: string,
    storageKey: string,
  ) => Promise<void>;
  deletePendingAttachments: (execSql: ExecSql, noteId: string) => Promise<void>;
  deletePendingAttachmentRewraps: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<void>;
  deletePendingAttachmentReplacement: (
    execSql: ExecSql,
    noteId: string,
    slotId: string,
  ) => Promise<void>;
  deletePendingAttachmentReplacements: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<void>;
}

function toDocumentPendingUpdate(
  pendingUpdate: PendingUpdateInsert,
): DocumentPersistence.PendingUpdateInsert {
  const { noteId, ...documentPendingUpdate } = pendingUpdate;
  return {
    ...documentPendingUpdate,
    localId: noteId,
  };
}

function toNotePendingAttachment(
  attachment: DocumentPersistence.PendingAttachmentRecord,
): PendingAttachmentRecord {
  const { localId, ...noteAttachment } = attachment;
  return {
    ...noteAttachment,
    noteId: localId,
  };
}

function toDocumentPendingAttachment(
  attachment: PendingAttachmentRecord,
): DocumentPersistence.PendingAttachmentRecord {
  const { noteId, ...documentAttachment } = attachment;
  return {
    ...documentAttachment,
    localId: noteId,
  };
}

function toNotePendingAttachmentRewrap(
  attachment: DocumentPersistence.PendingAttachmentRewrapRecord,
): PendingAttachmentRewrapRecord {
  const { localId, ...noteAttachment } = attachment;
  return {
    ...noteAttachment,
    noteId: localId,
  };
}

function toDocumentPendingAttachmentRewrap(
  attachment: PendingAttachmentRewrapRecord,
): DocumentPersistence.PendingAttachmentRewrapRecord {
  const { noteId, ...documentAttachment } = attachment;
  return {
    ...documentAttachment,
    localId: noteId,
  };
}

function toNotePendingAttachmentReplacement(
  attachment: DocumentPersistence.PendingAttachmentReplacementRecord,
): PendingAttachmentReplacementRecord {
  const { localId, ...noteAttachment } = attachment;
  return {
    ...noteAttachment,
    noteId: localId,
  };
}

function toDocumentPendingAttachmentReplacement(
  attachment: PendingAttachmentReplacementRecord,
): DocumentPersistence.PendingAttachmentReplacementRecord {
  const { noteId, ...documentAttachment } = attachment;
  return {
    ...documentAttachment,
    localId: noteId,
  };
}

function toNoteLocalAttachment(
  attachment: DocumentPersistence.LocalAttachmentRecord,
): LocalAttachmentRecord {
  const { localId, ...noteAttachment } = attachment;
  return {
    ...noteAttachment,
    noteId: localId,
  };
}

function toDocumentLocalAttachment(
  attachment: LocalAttachmentRecord,
): DocumentPersistence.LocalAttachmentRecord {
  const { noteId, ...documentAttachment } = attachment;
  return {
    ...documentAttachment,
    localId: noteId,
  };
}

function toDocumentRelinkInput(
  input: RelinkPersistedNoteInput,
): DocumentPersistence.RelinkPersistedDocumentInput {
  const { noteId, ...documentInput } = input;
  return {
    ...documentInput,
    localId: noteId,
  };
}

export async function listNotesByContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<NoteSummary[]> {
  return listDocumentsByContainerIds(execSql, containerIds);
}

function createAdaptedPersistenceReadMethods(
  notesPersistence: NotesPersistence,
): Pick<
  DocumentPersistence.DocumentsPersistence,
  | "ensureSchema"
  | "listDocuments"
  | "listDocumentsByContainerIdsOrDocumentIds"
  | "loadDocument"
  | "saveDocument"
  | "upsertDiscoveredDocument"
  | "relinkPersistedDocument"
> {
  return {
    ensureSchema(execSql) {
      return notesPersistence.ensureSchema(execSql);
    },
    listDocuments(execSql) {
      return notesPersistence.listNotes(execSql);
    },
    listDocumentsByContainerIdsOrDocumentIds(execSql, input) {
      return notesPersistence.listNotesByContainerIdsOrDocumentIds(
        execSql,
        input,
      );
    },
    loadDocument(execSql, localId) {
      return notesPersistence.loadNote(execSql, localId);
    },
    saveDocument(execSql, document, options) {
      return notesPersistence.saveNote(execSql, document, options);
    },
    upsertDiscoveredDocument(execSql, input) {
      return notesPersistence.upsertDiscoveredNote(execSql, input);
    },
    relinkPersistedDocument(execSql, { localId, ...input }) {
      return notesPersistence.relinkPersistedNote(execSql, {
        ...input,
        noteId: localId,
      });
    },
  };
}

function createAdaptedPersistencePendingReadMethods(
  notesPersistence: NotesPersistence,
): Pick<
  DocumentPersistence.DocumentsPersistence,
  | "listPendingUpdates"
  | "listPendingAttachments"
  | "listPendingAttachmentRewraps"
  | "listPendingAttachmentReplacements"
  | "listLocalAttachments"
> {
  return {
    listPendingUpdates(execSql, localId) {
      return notesPersistence.listPendingUpdates(execSql, localId);
    },
    async listPendingAttachments(execSql, localId) {
      const attachments = await notesPersistence.listPendingAttachments(
        execSql,
        localId,
      );
      return attachments.map(toDocumentPendingAttachment);
    },
    async listPendingAttachmentRewraps(execSql, localId) {
      const attachments = await notesPersistence.listPendingAttachmentRewraps(
        execSql,
        localId,
      );
      return attachments.map(toDocumentPendingAttachmentRewrap);
    },
    async listPendingAttachmentReplacements(execSql, localId) {
      const attachments =
        await notesPersistence.listPendingAttachmentReplacements(
          execSql,
          localId,
        );
      return attachments.map(toDocumentPendingAttachmentReplacement);
    },
    async listLocalAttachments(execSql, localId) {
      const attachments = await notesPersistence.listLocalAttachments(
        execSql,
        localId,
      );
      return attachments.map(toDocumentLocalAttachment);
    },
  };
}

function createAdaptedPersistenceMutationMethods(
  notesPersistence: NotesPersistence,
): Pick<
  DocumentPersistence.DocumentsPersistence,
  | "enqueuePendingUpdate"
  | "saveLocalAttachment"
  | "savePendingAttachment"
  | "savePendingAttachmentRewrap"
  | "savePendingAttachmentReplacement"
  | "deletePendingUpdate"
  | "deletePendingUpdates"
  | "deletePendingAttachment"
  | "deletePendingAttachments"
  | "deletePendingAttachmentRewraps"
  | "deletePendingAttachmentReplacement"
  | "deletePendingAttachmentReplacements"
> {
  return {
    enqueuePendingUpdate(execSql, { localId, ...pendingUpdate }) {
      return notesPersistence.enqueuePendingUpdate(execSql, {
        ...pendingUpdate,
        noteId: localId,
      });
    },
    saveLocalAttachment(execSql, { localId, ...attachment }) {
      return notesPersistence.saveLocalAttachment(execSql, {
        ...attachment,
        noteId: localId,
      });
    },
    savePendingAttachment(execSql, { localId, ...attachment }) {
      return notesPersistence.savePendingAttachment(execSql, {
        ...attachment,
        noteId: localId,
      });
    },
    savePendingAttachmentRewrap(execSql, { localId, ...attachment }) {
      return notesPersistence.savePendingAttachmentRewrap(execSql, {
        ...attachment,
        noteId: localId,
      });
    },
    savePendingAttachmentReplacement(execSql, { localId, ...attachment }) {
      return notesPersistence.savePendingAttachmentReplacement(execSql, {
        ...attachment,
        noteId: localId,
      });
    },
    deletePendingUpdate(execSql, id) {
      return notesPersistence.deletePendingUpdate(execSql, id);
    },
    deletePendingUpdates(execSql, localId) {
      return notesPersistence.deletePendingUpdates(execSql, localId);
    },
    deletePendingAttachment(execSql, localId, slotId, storageKey) {
      return notesPersistence.deletePendingAttachment(
        execSql,
        localId,
        slotId,
        storageKey,
      );
    },
    deletePendingAttachments(execSql, localId) {
      return notesPersistence.deletePendingAttachments(execSql, localId);
    },
    deletePendingAttachmentRewraps(execSql, localId) {
      return notesPersistence.deletePendingAttachmentRewraps(execSql, localId);
    },
    deletePendingAttachmentReplacement(execSql, localId, slotId) {
      return notesPersistence.deletePendingAttachmentReplacement(
        execSql,
        localId,
        slotId,
      );
    },
    deletePendingAttachmentReplacements(execSql, localId) {
      return notesPersistence.deletePendingAttachmentReplacements(
        execSql,
        localId,
      );
    },
  };
}

export function adaptNotesPersistence(
  notesPersistence: NotesPersistence,
): DocumentPersistence.DocumentsPersistence {
  return {
    ...createAdaptedPersistenceReadMethods(notesPersistence),
    ...createAdaptedPersistencePendingReadMethods(notesPersistence),
    ...createAdaptedPersistenceMutationMethods(notesPersistence),
  };
}

export const sqlNotesPersistence: NotesPersistence = {
  ensureSchema(execSql) {
    return sqlDocumentsPersistence.ensureSchema(execSql);
  },
  listNotes(execSql) {
    return sqlDocumentsPersistence.listDocuments(execSql);
  },
  listNotesByContainerIdsOrDocumentIds(execSql, input) {
    return sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
      execSql,
      input,
    );
  },
  loadNote(execSql, noteId) {
    return sqlDocumentsPersistence.loadDocument(execSql, noteId);
  },
  saveNote(execSql, note, options) {
    return sqlDocumentsPersistence.saveDocument(execSql, note, options);
  },
  upsertDiscoveredNote(execSql, input) {
    return sqlDocumentsPersistence.upsertDiscoveredDocument(execSql, input);
  },
  relinkPersistedNote(execSql, input) {
    return sqlDocumentsPersistence.relinkPersistedDocument(
      execSql,
      toDocumentRelinkInput(input),
    );
  },
  listPendingUpdates(execSql, noteId) {
    return sqlDocumentsPersistence.listPendingUpdates(execSql, noteId);
  },
  async listPendingAttachments(execSql, noteId) {
    const attachments = await sqlDocumentsPersistence.listPendingAttachments(
      execSql,
      noteId,
    );
    return attachments.map(toNotePendingAttachment);
  },
  async listPendingAttachmentRewraps(execSql, noteId) {
    const attachments =
      await sqlDocumentsPersistence.listPendingAttachmentRewraps(
        execSql,
        noteId,
      );
    return attachments.map(toNotePendingAttachmentRewrap);
  },
  async listPendingAttachmentReplacements(execSql, noteId) {
    const attachments =
      await sqlDocumentsPersistence.listPendingAttachmentReplacements(
        execSql,
        noteId,
      );
    return attachments.map(toNotePendingAttachmentReplacement);
  },
  async listLocalAttachments(execSql, noteId) {
    const attachments = await sqlDocumentsPersistence.listLocalAttachments(
      execSql,
      noteId,
    );
    return attachments.map(toNoteLocalAttachment);
  },
  enqueuePendingUpdate(execSql, pendingUpdate) {
    return sqlDocumentsPersistence.enqueuePendingUpdate(
      execSql,
      toDocumentPendingUpdate(pendingUpdate),
    );
  },
  saveLocalAttachment(execSql, attachment) {
    return sqlDocumentsPersistence.saveLocalAttachment(
      execSql,
      toDocumentLocalAttachment(attachment),
    );
  },
  savePendingAttachment(execSql, attachment) {
    return sqlDocumentsPersistence.savePendingAttachment(
      execSql,
      toDocumentPendingAttachment(attachment),
    );
  },
  savePendingAttachmentRewrap(execSql, attachment) {
    return sqlDocumentsPersistence.savePendingAttachmentRewrap(
      execSql,
      toDocumentPendingAttachmentRewrap(attachment),
    );
  },
  savePendingAttachmentReplacement(execSql, attachment) {
    return sqlDocumentsPersistence.savePendingAttachmentReplacement(
      execSql,
      toDocumentPendingAttachmentReplacement(attachment),
    );
  },
  deletePendingUpdate(execSql, id) {
    return sqlDocumentsPersistence.deletePendingUpdate(execSql, id);
  },
  deletePendingUpdates(execSql, noteId) {
    return sqlDocumentsPersistence.deletePendingUpdates(execSql, noteId);
  },
  deletePendingAttachment(execSql, noteId, slotId, storageKey) {
    return sqlDocumentsPersistence.deletePendingAttachment(
      execSql,
      noteId,
      slotId,
      storageKey,
    );
  },
  deletePendingAttachments(execSql, noteId) {
    return sqlDocumentsPersistence.deletePendingAttachments(execSql, noteId);
  },
  deletePendingAttachmentRewraps(execSql, noteId) {
    return sqlDocumentsPersistence.deletePendingAttachmentRewraps(
      execSql,
      noteId,
    );
  },
  deletePendingAttachmentReplacement(execSql, noteId, slotId) {
    return sqlDocumentsPersistence.deletePendingAttachmentReplacement(
      execSql,
      noteId,
      slotId,
    );
  },
  deletePendingAttachmentReplacements(execSql, noteId) {
    return sqlDocumentsPersistence.deletePendingAttachmentReplacements(
      execSql,
      noteId,
    );
  },
};
