import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  ContainerAccessLevel,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  PredecessorContainerKekResponse,
} from "@tearleads/validators/response";

type ContainerWriterProjectionStatus = 403 | 404 | 409;

export const CONTAINER_WRITER_PROJECTION_ERROR_CODES = {
  predecessorHistoryUnavailable: "predecessor_history_unavailable",
} as const;

type ContainerWriterProjectionErrorCode =
  (typeof CONTAINER_WRITER_PROJECTION_ERROR_CODES)[keyof typeof CONTAINER_WRITER_PROJECTION_ERROR_CODES];

export class ContainerWriterProjectionError extends Error {
  constructor(
    message: string,
    readonly status: ContainerWriterProjectionStatus,
    readonly code: ContainerWriterProjectionErrorCode | null = null,
  ) {
    super(message);
    this.name = "ContainerWriterProjectionError";
  }
}

export interface ContainerPathRow {
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string | null;
}

export interface ContainerAccessProjection {
  readonly accessLevel: ContainerAccessLevel;
  readonly path: AccessManifestBundleWireResponse[];
  readonly principalPolicies: VerifiedPrincipalPolicy[];
  readonly verifiedPath: VerifiedContainerAccessManifest[];
}

export type ContainerAccessProjectionResult =
  | {
      readonly status: "fulfilled";
      readonly value: ContainerAccessProjection;
    }
  | {
      readonly reason: ContainerWriterProjectionError;
      readonly status: "rejected";
    };

export interface ContainerWriterProjectionContext {
  readonly containerKekStateByCacheKey: Map<
    string,
    Promise<ContainerKekProjection>
  >;
  readonly containerPathRowById: Map<string, Promise<ContainerPathRow>>;
  readonly executor: DatabaseSession;
  readonly currentManifestBundleByContainerId: Map<
    string,
    Promise<AccessManifestBundleWireResponse>
  >;
  readonly manifestBundleByHash: Map<
    string,
    Promise<AccessManifestBundleWireResponse>
  >;
  readonly predecessorContainerKeksByEpochId: Map<
    string,
    Promise<PredecessorContainerKekResponse[]>
  >;
}

export interface ContainerKekManifestHistory {
  readonly bundles: AccessManifestBundleWireResponse[];
  readonly verified: VerifiedContainerAccessManifest[];
}

export interface ContainerKekProjection {
  readonly manifestHistory: AccessManifestBundleWireResponse[];
  readonly state: VerifiedContainerKekState;
}

export interface ContainerAccessPath {
  readonly path: AccessManifestBundleWireResponse[];
  readonly verifiedPath: VerifiedContainerAccessManifest[];
}
