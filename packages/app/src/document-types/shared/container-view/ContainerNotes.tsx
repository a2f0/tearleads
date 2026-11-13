import type { ContainerDocumentQueries } from "@tearleads/client-sdk";
import { useCallback, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { NoteDocumentApp } from "../../note/NoteDocumentApp";
import { useContainerViewResource } from "./useContainerViewResource";

const PAGE_SIZE = 5;
export function ContainerNotes({
  containerId,
  documentQueries,
  revision,
  onOpenDocument,
}: {
  containerId: string;
  documentQueries: ContainerDocumentQueries;
  revision: number;
  onOpenDocument: (localId: string, containerId: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const load = useCallback(() => {
    void revision;
    return documentQueries.listContainerDocumentSidebarWindow({
      containerId,
      documentKind: "note",
      offset,
      limit: PAGE_SIZE,
    });
  }, [containerId, documentQueries, offset, revision]);
  const page = useContainerViewResource(load);
  return (
    <section aria-label="Container notes" className="container-view-notes">
      <h3>Notes</h3>
      {page.status === "loading" ? (
        <MiniAppStatus>Loading notes…</MiniAppStatus>
      ) : null}
      {page.status === "failed" ? (
        <MiniAppStatus tone="error">{page.error}</MiniAppStatus>
      ) : null}
      {page.status === "ready" ? (
        <>
          {page.value.totalCount === 0 ? (
            <MiniAppStatus>No notes in this container.</MiniAppStatus>
          ) : null}
          {page.value.rows.map((note) => (
            <article key={note.localId} className="container-view-note">
              <MiniAppButton
                onClick={() => onOpenDocument(note.localId, containerId)}
              >
                Open {note.title || "note"}
              </MiniAppButton>
              <NoteDocumentApp
                localId={note.localId}
                documentId={note.documentId}
                containerId={containerId}
                readOnly
              />
            </article>
          ))}
          <nav aria-label="Note pages">
            <MiniAppButton
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous notes
            </MiniAppButton>
            <span>{page.value.totalCount} notes</span>
            <MiniAppButton
              disabled={offset + PAGE_SIZE >= page.value.totalCount}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next notes
            </MiniAppButton>
          </nav>
        </>
      ) : null}
    </section>
  );
}
