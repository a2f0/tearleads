import type { ContainerDocumentQueries } from "@tearleads/client-sdk";

/** A container view renders one container through its primary document. */
export interface ContainerViewProps {
  /** The selected container, which may differ from the document's home. */
  containerId: string;
  /** Canonical id of the primary document. */
  documentId: string | null;
  documentQueries: ContainerDocumentQueries;
  /** Local id of the primary document on this device. */
  localId: string;
  onOpenDocument: (localId: string, containerId: string) => void;
  readOnly: boolean;
  /** Projection revision; shared sections reload when it changes. */
  revision: number;
}
