import "./ContactMedications.css";
import { useCallback, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { MEDICATION_DOCUMENT_KIND } from "../../medication/medicationDocumentDefinition";
import type { ContainerViewProps } from "../shared/containerViewTypes";
import { useContainerViewResource } from "../shared/useContainerViewResource";

const PAGE_SIZE = 10;

/**
 * The medication records filed with this person, by title. Each entry opens
 * the record itself, so the overview holds no copy of what it lists.
 */
export function ContactMedications({
  containerId,
  documentQueries,
  onOpenDocument,
  revision,
}: Pick<
  ContainerViewProps,
  "containerId" | "documentQueries" | "onOpenDocument" | "revision"
>) {
  const [offset, setOffset] = useState(0);
  const load = useCallback(() => {
    void revision;
    return documentQueries.listContainerDocumentSidebarWindow({
      containerId,
      documentKind: MEDICATION_DOCUMENT_KIND,
      offset,
      limit: PAGE_SIZE,
    });
  }, [containerId, documentQueries, offset, revision]);
  const page = useContainerViewResource(load);

  return (
    <section aria-label="Medications" className="contact-medications">
      <h3>Medications</h3>
      {page.status === "loading" ? (
        <MiniAppStatus>Loading medications…</MiniAppStatus>
      ) : null}
      {page.status === "failed" ? (
        <MiniAppStatus tone="error">{page.error}</MiniAppStatus>
      ) : null}
      {page.status === "ready" && page.value.totalCount === 0 ? (
        <MiniAppStatus>No medications in this container.</MiniAppStatus>
      ) : null}
      {page.status === "ready" && page.value.totalCount > 0 ? (
        <>
          <ul>
            {page.value.rows.map((medication) => (
              <li key={medication.localId}>
                <MiniAppButton
                  onClick={() =>
                    onOpenDocument(medication.localId, containerId)
                  }
                >
                  {medication.title || "Untitled medication"}
                </MiniAppButton>
              </li>
            ))}
          </ul>
          {page.value.totalCount > PAGE_SIZE ? (
            <nav aria-label="Medication pages">
              <MiniAppButton
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous medications
              </MiniAppButton>
              <span>{page.value.totalCount} medications</span>
              <MiniAppButton
                disabled={offset + PAGE_SIZE >= page.value.totalCount}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next medications
              </MiniAppButton>
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
