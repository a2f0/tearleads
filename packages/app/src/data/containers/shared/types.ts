import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
  ContainerDirectGrant,
  ContainerGrantAccessEventBody,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerMoveAccessEventBody,
  ContainerUserRecipientKey,
} from "@tearleads/crypto";
import type {
  ContainerManifestBundle,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerKekResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ExecSql } from "../../sqlite/sqlSchema";

export interface ContainerMutationAuthor {
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}

export interface BuildContainerCreatePlanInput {
  author: ContainerMutationAuthor;
  containerId?: string | undefined;
  containerKey: Uint8Array;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  metadataDocumentId?: string | undefined;
  parentKekMaterial: Uint8Array;
  parentProjection: ContainerWriterProjectionResponse;
  signedAt?: string | undefined;
}

export interface ContainerCreatePlan {
  body: ContainerCreateAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyEpochHash: string;
  keyTargetHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  metadataDocumentId: string;
  parentContainerId: string | null;
  parentManifestHash: string | null;
  recipientTargets: ContainerKekRecipientTarget[];
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  wraps: ContainerKeyWrap[];
}

export interface MaterializedContainerCreatePlan {
  containerKey: Uint8Array;
  plan: ContainerCreatePlan;
}

export interface ContainerCreatePlanContext
  extends BuildContainerCreatePlanInput {
  containerId: string;
  containerKeyEpochId: string;
  eventId: string;
  metadataDocumentId: string;
  parent: ParentContainerCreateContext;
  signedAt: string;
}

export interface ContainerCreateApi {
  createContainer(
    input: ContainerMutationRequest,
  ): Promise<ContainerMutationResponse | null>;
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
}

export interface ContainerShareApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  shareContainer(
    containerId: string,
    input: ContainerMutationRequest,
  ): Promise<ContainerMutationResponse | null>;
}

export interface ContainerMoveApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  moveContainer(
    containerId: string,
    input: ContainerMutationRequest,
  ): Promise<ContainerMutationResponse | null>;
}

export interface CreateRemoteContainerResult {
  containerKey: Uint8Array;
  containerId: string;
  metadataDocumentId: string;
  plan: ContainerCreatePlan;
  response: ContainerMutationResponse;
}

export interface ContainerSharePlan {
  body: ContainerGrantAccessEventBody;
  containerId: string;
  event: AccessEvent;
  eventHash: string;
  grant: ContainerDirectGrant;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: ContainerManifestBundle;
  recipientTarget: ContainerKekRecipientTarget;
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}

export interface MaterializedContainerSharePlan {
  containerKey: Uint8Array;
  plan: ContainerSharePlan;
}

export interface ContainerMovePlan {
  body: ContainerMoveAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: ContainerManifestBundle;
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  wraps: ContainerKeyWrap[];
}

export interface MaterializedContainerMovePlan {
  containerKey: Uint8Array;
  plan: ContainerMovePlan;
}

export interface BuildMaterializedContainerMovePlanInput {
  author: ContainerMutationAuthor;
  containerKeyEpochId?: string | undefined;
  destinationParentProjection: ContainerWriterProjectionResponse;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}

export interface ParentContainerCreateContext {
  manifest: ContainerWriterProjectionResponse["path"][number];
  kek: ContainerKekResponse;
}
