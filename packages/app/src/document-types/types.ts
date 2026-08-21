import type { Icon } from "@phosphor-icons/react";
import type { DocumentProjectorDefinition } from "@symcrypt/client-sdk";

export interface DocumentTypeAppProps {
  containerId?: string | null;
  documentId?: string | null;
  initialEditing?: boolean | undefined;
  localId?: string;
  // Forces the rendered document read-only regardless of write access — set by a
  // host that opened a trashed object. Forwarded to DocumentsProvider, which
  // folds it into canWrite/canAttach so every editor and edit affordance is
  // read-only or hidden.
  readOnly?: boolean | undefined;
}

export interface AppDocumentProjectorDefinition
  extends DocumentProjectorDefinition {
  createIcon: Icon;
  createLabel: string;
}
