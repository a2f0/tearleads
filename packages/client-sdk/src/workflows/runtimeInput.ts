import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../data/blobContracts";
import type { DocumentProjectorRegistry } from "../data/documents/documentKinds";
import type { DomainScope } from "../data/domainScope";
import type { ExecSql } from "../data/sqlite/sqlSchema";

export type WorkflowRuntimeDatabaseStatus =
  | "idle"
  | "ready"
  | "error"
  | "terminated";

export interface WorkflowRuntimeAuthInput {
  readonly isAuthenticated: boolean;
  readonly organizationId: string | null;
  readonly userId: string | null;
}

export interface WorkflowRuntimeCryptoInput {
  readonly encapsulationKeyPair: EncapsulationKeyPair | null;
  readonly signingFingerprint: string | null;
  readonly signingKeyPair: SigningKeyPair | null;
}

export interface WorkflowRuntimeStateInput {
  readonly containerId: string | null;
  readonly domainScope: DomainScope;
  readonly events: ReadonlyArray<unknown>;
  readonly online: boolean;
  /**
   * Per-pane CRDT peer-seed discriminator (e.g. the pane's local identity
   * namespace). Documents in distinct panes must derive distinct Loro peer ids;
   * absent/`null` means single-pane (bare scope). The document runtime factory
   * always populates it; other runtimes and test fixtures may omit it.
   */
  readonly peerScope?: string | null;
}

export interface WorkflowRuntimeInfraInput {
  readonly blobStore: BlobStore;
  readonly dbStatus: WorkflowRuntimeDatabaseStatus;
  readonly documentProjectors: DocumentProjectorRegistry;
  readonly execSql: ExecSql;
}

export interface WorkflowRuntimeUtilInput {
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  readonly isRemoteSyncBlocked?:
    | ((organizationId: string) => boolean)
    | undefined;
  readonly log: (message: string) => void;
  readonly logError: (message: string | Error, cause?: unknown) => void;
}

export interface WorkflowRuntimeGroups {
  readonly auth: WorkflowRuntimeAuthInput;
  readonly crypto: WorkflowRuntimeCryptoInput;
  readonly infra: WorkflowRuntimeInfraInput;
  readonly state: WorkflowRuntimeStateInput;
  readonly util: WorkflowRuntimeUtilInput;
}
