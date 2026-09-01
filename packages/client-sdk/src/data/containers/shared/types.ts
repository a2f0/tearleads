import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
  ContainerDirectGrant,
  ContainerGrantAccessEventBody,
  ContainerGrantPrincipalHead,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerMoveAccessEventBody,
  ContainerRekeyAccessEventBody,
  ContainerRevokeAccessEventBody,
  ContainerUserRecipientKey,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerKekResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
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
  /**
   * Optional group grant to bake into the
   * create manifest, wrapping the new container key to that principal in
   * addition to the normal parent-inheritance wrap. Used to birth a child
   * container that is directly readable by a group — e.g. the org public
   * metadata container granted to the reserved Members group. The principal's
   * verified policy must also be supplied via `principalPolicies` so the server
   * can derive the recipient target.
   */
  managedPrincipalGrant?:
    | {
        accessLevel: ContainerDirectGrant["accessLevel"];
        principalEncapsulationPublicKey: string;
        principalHead: ContainerGrantPrincipalHead;
      }
    | undefined;
  metadataDocumentId?: string | undefined;
  parentKekMaterial: Uint8Array;
  parentProjection: ContainerWriterProjectionResponse;
  principalPolicies?: readonly VerifiedPrincipalPolicy[] | undefined;
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

export interface ContainerMutationSubmitFailure {
  readonly message: string;
  readonly ok: false;
  readonly report: () => void;
  readonly stalePrincipalPolicies?:
    | readonly PrincipalPolicyBundleResponse[]
    | undefined;
  readonly status: number | null;
}

export type ContainerMutationSubmitResult<T> =
  | {
      readonly data: T;
      readonly ok: true;
    }
  | ContainerMutationSubmitFailure;

export interface ContainerCreateApi {
  createContainer(
    input: ContainerMutationRequest,
  ): Promise<ContainerMutationResponse | null>;
  createContainerResult?(
    input: ContainerMutationRequest,
    options?: { readonly reportErrors?: boolean | undefined },
  ): Promise<ContainerMutationSubmitResult<ContainerMutationResponse>>;
  createContainerWithMetadataDocument?(
    input: ContainerCreateWithMetadataDocumentRequest,
  ): Promise<ContainerCreateWithMetadataDocumentResponse | null>;
  createContainerWithMetadataDocumentResult?(
    input: ContainerCreateWithMetadataDocumentRequest,
    options?: { readonly reportErrors?: boolean | undefined },
  ): Promise<
    ContainerMutationSubmitResult<ContainerCreateWithMetadataDocumentResponse>
  >;
  evictContainerWriterProjection?(containerId: string): void;
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  getCurrentPrincipalPolicy(
    principalType: "group" | "organization",
    principalId: string,
  ): Promise<PrincipalPolicyBundleResponse | null>;
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

export interface ContainerRevokeApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  revokeContainer(
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
  /** The unchanged epoch's stored keyring, echoed back by the server. */
  previousKeyring?: Record<string, unknown> | null | undefined;
  containerId: string;
  event: AccessEvent;
  eventHash: string;
  grant: ContainerDirectGrant;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
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

export interface ContainerRevokePlan {
  body: ContainerRevokeAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}

export interface MaterializedContainerRevokePlan {
  containerKey: Uint8Array;
  plan: ContainerRevokePlan;
}

export interface ContainerRekeyPlan {
  body: ContainerRekeyAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}

export interface MaterializedContainerRekeyPlan {
  containerKey: Uint8Array;
  plan: ContainerRekeyPlan;
}

export interface ContainerRekeyApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  rekeyContainer(
    containerId: string,
    input: ContainerMutationRequest,
  ): Promise<ContainerMutationResponse | null>;
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
  previousManifest: AccessManifestBundleWire;
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
  execSql: ExecSql;
  previousProjection: ContainerWriterProjectionResponse;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}

export interface ParentContainerCreateContext {
  manifest: ContainerWriterProjectionResponse["path"][number];
  kek: ContainerKekResponse;
}
