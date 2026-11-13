import type { ContainerDocumentQueries } from "@tearleads/client-sdk";
import { useCallback, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { useContainerViewResource } from "./useContainerViewResource";

const PAGE_SIZE = 20;
export function ContainerPrimaryPicker({
  containerId,
  documentQueries,
  revision,
  busy,
  onChoose,
  onCancel,
}: {
  containerId: string;
  documentQueries: ContainerDocumentQueries;
  revision: number;
  busy: boolean;
  onChoose: (documentId: string) => void;
  onCancel: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const load = useCallback(() => {
    void revision;
    return documentQueries.listContainerDocumentSidebarWindow({
      containerId,
      offset,
      limit: PAGE_SIZE,
    });
  }, [containerId, documentQueries, offset, revision]);
  const page = useContainerViewResource(load);
  return (
    <section
      aria-label="Choose primary document"
      className="container-primary-picker"
    >
      <p>
        Choose a document linked in this container. Contact views show notes
        underneath. Other types keep the contents list.
      </p>
      <p>New offline documents become available here after their first sync.</p>
      {page.status === "loading" ? (
        <MiniAppStatus>Loading documents…</MiniAppStatus>
      ) : null}
      {page.status === "failed" ? (
        <MiniAppStatus tone="error">{page.error}</MiniAppStatus>
      ) : null}
      {page.status === "ready" ? (
        <>
          {page.value.totalCount === 0 ? (
            <MiniAppStatus>No documents in this container.</MiniAppStatus>
          ) : null}
          <ul>
            {page.value.rows.map((row) => (
              <li key={row.localId}>
                <MiniAppButton
                  disabled={busy || !row.documentId}
                  onClick={() => {
                    if (row.documentId) onChoose(row.documentId);
                  }}
                >
                  Use {row.title || "document"} as primary
                </MiniAppButton>
                {!row.documentId ? (
                  <span> — available after first sync</span>
                ) : null}
              </li>
            ))}
          </ul>
          <nav aria-label="Primary document pages">
            <MiniAppButton
              disabled={busy || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous documents
            </MiniAppButton>
            <span>{page.value.totalCount} documents</span>
            <MiniAppButton
              disabled={busy || offset + PAGE_SIZE >= page.value.totalCount}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next documents
            </MiniAppButton>
          </nav>
        </>
      ) : null}
      <MiniAppButton disabled={busy} onClick={onCancel}>
        Cancel
      </MiniAppButton>
    </section>
  );
}
