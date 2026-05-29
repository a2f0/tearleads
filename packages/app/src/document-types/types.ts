import type { DocumentProjectorDefinition } from "@tearleads/client-sdk";

export interface DocumentTypeAppProps {
  containerId?: string | null;
  documentId?: string | null;
  localId?: string;
}

export interface AppDocumentProjectorDefinition
  extends DocumentProjectorDefinition {
  createLabel: string;
}
