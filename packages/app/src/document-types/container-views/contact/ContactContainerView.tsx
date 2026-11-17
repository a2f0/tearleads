import { ContactDocumentApp } from "../../contact/ContactDocumentApp";
import { ContainerNotes } from "../shared/ContainerNotes";
import type { ContainerViewProps } from "../shared/containerViewTypes";

/** The contact itself, with the container's notes underneath. */
export function ContactContainerView({
  containerId,
  documentId,
  documentQueries,
  localId,
  onOpenDocument,
  readOnly,
  revision,
}: ContainerViewProps) {
  return (
    <>
      <ContactDocumentApp
        containerId={containerId}
        localId={localId}
        documentId={documentId}
        readOnly={readOnly}
      />
      <ContainerNotes
        containerId={containerId}
        documentQueries={documentQueries}
        revision={revision}
        onOpenDocument={onOpenDocument}
      />
    </>
  );
}
