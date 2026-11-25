import { ContactDocumentApp } from "../../contact/ContactDocumentApp";
import { ContainerNotes } from "../shared/ContainerNotes";
import type { ContainerViewProps } from "../shared/containerViewTypes";
import { ContactMedications } from "./ContactMedications";

/**
 * The contact itself, then the medications filed with them, then the
 * container's notes.
 */
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
      <ContactMedications
        containerId={containerId}
        documentQueries={documentQueries}
        revision={revision}
        onOpenDocument={onOpenDocument}
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
