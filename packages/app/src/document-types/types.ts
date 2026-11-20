import type { Icon } from "@phosphor-icons/react";
import type { DocumentProjectorDefinition } from "@tearleads/client-sdk";

import type { DocumentPhotoCapability } from "./shared/documentPhotos";

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
  photos?: DocumentPhotoCapability | undefined;
  createIcon: Icon;
  createLabel: string;
}
