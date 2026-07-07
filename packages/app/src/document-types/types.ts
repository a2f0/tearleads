import type { Icon } from "@phosphor-icons/react";
import type { DocumentProjectorDefinition } from "@tearleads/client-sdk";

export interface DocumentTypeAppProps {
  containerId?: string | null;
  documentId?: string | null;
  initialEditing?: boolean | undefined;
  localId?: string;
}

export interface AppDocumentProjectorDefinition
  extends DocumentProjectorDefinition {
  createIcon: Icon;
  createLabel: string;
}
