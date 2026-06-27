import type { ContainerAccessLevel } from "@tearleads/crypto";
import type { StoredDocumentKind } from "./documents/documentKinds";

export interface DocumentSummary {
  accessStateHash?: string | null;
  createdAt?: string | null;
  effectiveAccessLevel?: ContainerAccessLevel | undefined;
  id: string;
  containerId: string | null;
  documentKind?: StoredDocumentKind;
  documentId: string | null;
  title: string;
  updatedAt: string;
}

export interface DiscoveredDocumentInput {
  accessEpoch: number;
  accessStateHash?: string | null;
  containerId: string;
  createdAt: string;
  documentId: string;
  effectiveAccessLevel?: ContainerAccessLevel | undefined;
  linkedContainerIds: ReadonlyArray<string>;
}
