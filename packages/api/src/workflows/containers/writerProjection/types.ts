import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  ContainerAccessLevel,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";

type ContainerWriterProjectionStatus = 403 | 404 | 409;

export class ContainerWriterProjectionError extends Error {
  constructor(
    message: string,
    readonly status: ContainerWriterProjectionStatus,
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
  readonly verifiedManifestByHash: Map<string, VerifiedContainerAccessManifest>;
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
