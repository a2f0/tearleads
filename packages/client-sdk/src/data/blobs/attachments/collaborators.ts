import type { SecurityIncidentReporter } from "../../shared/securityIncidents";
import type { ExecSql } from "../../sqlite/sqlSchema";
import type {
  BlobAttachmentApi,
  BlobAttachmentDetachApi,
  DocumentAttachmentHydrationApi,
} from "./types";

/** The API slices a `BlobAttachmentService` calls. */
export type BlobAttachmentServiceApi = BlobAttachmentApi &
  BlobAttachmentDetachApi &
  DocumentAttachmentHydrationApi;

/**
 * What a `BlobAttachmentService` binds for its lifetime, one documents runtime
 * snapshot: the executor and key material that snapshot carries, so a call
 * never mixes one snapshot's executor with another's key.
 */
export interface BlobAttachmentCollaborators {
  readonly api: BlobAttachmentServiceApi;
  readonly execSql: ExecSql;
  /** The local identity's encapsulation secret key; null before it has one. */
  readonly encapsulationSecretKey: Uint8Array | null;
  readonly log?: ((message: string) => void) | undefined;
  readonly reportSecurityIncident?: SecurityIncidentReporter | undefined;
}

/** The secret key for an operation that unwraps blob content keys. */
export function requireEncapsulationSecretKey(
  blobs: BlobAttachmentCollaborators,
  operation: string,
): Uint8Array {
  if (!blobs.encapsulationSecretKey) {
    throw new Error(`${operation} requires an encapsulation key`);
  }
  return blobs.encapsulationSecretKey;
}
