import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import type {
  AnyVerifiedPrincipalPolicy,
  ContainerAccessLevel,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type { AccessManifestBundleWireResponse } from "@symcrypt/validators/response";

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
  readonly principalPolicyAuthorizationEvidence: readonly AnyVerifiedPrincipalPolicy[];
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
