import { expect, type Page, type Response } from "@playwright/test";
import { SIGNED_IN_API_URL } from "./signedInServer";

interface CreatedDocument {
  readonly id: string;
  readonly initialSync?: { readonly acceptedOutgoingUpdateIds: string[] };
}

interface SyncResponse {
  readonly acceptedOutgoingUpdateIds: string[];
}

/** Uploads the server accepted for one note, counted as they arrive. */
export interface NoteUploads {
  /** Resolves once the server has accepted `count` of the note's uploads. */
  accepted(count: number): Promise<void>;
  stop(): void;
}

/**
 * Watches the uploads the server accepts for the next note created in the
 * folder `folderId`: its create, when that carries the first edit, and each
 * sync that sends edits. A create carries the first edit only when the edit
 * was queued before the create went out, so neither is assumed. Paths alone
 * are not enough either: a new profile creates and syncs system documents of
 * its own meanwhile. Responses are read one at a time, in arrival order, so the
 * note's create is always seen before its syncs.
 */
export function watchNoteUploads(page: Page, folderId: string): NoteUploads {
  let noteId: string | null = null;
  let acceptedUploads = 0;
  let failure: unknown = null;
  let reading = Promise.resolve();

  const acceptedUpdates = async (response: Response): Promise<number> => {
    const url = new URL(response.url());
    if (
      url.origin !== SIGNED_IN_API_URL ||
      response.request().method() !== "POST" ||
      response.status() !== 200
    ) {
      return 0;
    }
    if (noteId === null) {
      if (
        url.pathname !== "/documents" ||
        response.request().postDataJSON()?.body?.containerId !== folderId
      ) {
        return 0;
      }
      const note = (await response.json()) as CreatedDocument;
      noteId = note.id;
      return note.initialSync?.acceptedOutgoingUpdateIds.length ?? 0;
    }
    if (url.pathname !== `/documents/${noteId}/sync`) return 0;
    const sync = (await response.json()) as SyncResponse;
    return sync.acceptedOutgoingUpdateIds.length;
  };

  const onResponse = (response: Response): void => {
    reading = reading.then(async () => {
      try {
        if ((await acceptedUpdates(response)) > 0) acceptedUploads += 1;
      } catch (error) {
        failure ??= error;
      }
    });
  };
  page.on("response", onResponse);

  return {
    async accepted(count) {
      try {
        await expect
          .poll(
            () => {
              if (failure !== null) throw failure;
              return acceptedUploads;
            },
            { timeout: 60_000 },
          )
          .toBeGreaterThanOrEqual(count);
      } catch (error) {
        throw new Error(
          noteId === null
            ? `No note was created in folder ${folderId}`
            : `The server accepted ${acceptedUploads} of ${count} uploads for note ${noteId}`,
          { cause: error },
        );
      }
    },
    stop() {
      page.off("response", onResponse);
    },
  };
}
