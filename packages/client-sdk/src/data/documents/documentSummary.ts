import type { ContainerAccessLevel } from "@symcrypt/crypto";
import type { StoredDocumentKind } from "./documentKinds";

/** Non-empty because callers use this tuple to build SQL `NOT IN` clauses. */
export const HIDDEN_DOCUMENT_SUMMARY_KINDS = [
  "organization_profile",
] as const satisfies readonly [StoredDocumentKind, ...StoredDocumentKind[]];

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
