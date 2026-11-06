import type { VerifiedAccessEvent } from "./accessEventTypes";
import type {
  AccessManifest,
  AccessManifestCheckpoint,
} from "./accessManifestTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";
import type { ReferencedPrincipalHead } from "./principalPolicyTypes";

export type ContainerAccessLevel = "admin" | "read" | "write";
export type ContainerGrantSubjectType = "group" | "user";

export type ContainerGrantPrincipalHead = ReferencedPrincipalHead & {
  principalType: "group";
};

export interface ContainerAccessManifest extends AccessManifest {
  objectKind: "container";
  referencedPrincipalHeads: ContainerGrantPrincipalHead[];
}

export interface ContainerDirectGrant {
  accessLevel: ContainerAccessLevel;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface ContainerAccessStructural {
  parentContainerId: string | null;
  parentManifestHash: string | null;
}

export interface ContainerAccessMetadata {
  metadataDocumentId: string;
  systemSlot: string | null;
}

export interface ContainerAccessKeyState {
  containerKeyEpochId: string | null;
  /** ML-KEM-1024 public key derived from this epoch's KEK and container ID. */
  containerKeyPublicKey: string | null;
}

export interface ContainerAccessManifestState
  extends ContainerAccessStructural,
    ContainerAccessKeyState,
    ContainerAccessMetadata {
  version: 1;
  containerId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
  directGrants: ContainerDirectGrant[];
  referencedPrincipalHeads: ContainerGrantPrincipalHead[];
}

export interface ContainerCreateAccessEventBody
  extends ContainerAccessStructural,
    ContainerAccessKeyState,
    ContainerAccessMetadata {
  eventType: "container.create";
  directGrants: ContainerDirectGrant[];
  referencedPrincipalHeads: ContainerGrantPrincipalHead[];
}

export interface ContainerGrantAccessEventBody extends ContainerAccessKeyState {
  eventType: "container.grant";
  grant: ContainerDirectGrant;
  referencedPrincipalHead: ContainerGrantPrincipalHead | null;
}

export interface ContainerRevokeAccessEventBody
  extends ContainerAccessKeyState {
  eventType: "container.revoke";
  parentManifestHash: string | null;
  keyringHash: string;
  predecessorBridgeHash: string;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface ContainerRekeyAccessEventBody {
  eventType: "container.rekey";
  parentManifestHash: string | null;
  containerKeyEpochId: string;
  containerKeyPublicKey: string;
  keyringHash: string;
  predecessorBridgeHash: string;
  referencedPrincipalHeads: ContainerGrantPrincipalHead[];
}

export interface ContainerReciteAccessEventBody
  extends ContainerAccessKeyState {
  eventType: "container.recite";
}

export interface ContainerMoveAccessEventBody
  extends ContainerAccessStructural,
    ContainerAccessKeyState {
  eventType: "container.move";
  keyringHash: string;
  predecessorBridgeHash: string;
}

export type ContainerAccessEventBody =
  | ContainerCreateAccessEventBody
  | ContainerGrantAccessEventBody
  | ContainerMoveAccessEventBody
  | ContainerReciteAccessEventBody
  | ContainerRekeyAccessEventBody
  | ContainerRevokeAccessEventBody;

const verifiedContainerAccessManifestBrand: unique symbol = Symbol(
  "verifiedContainerAccessManifest",
);

const verifiedContainerParentEdgeBrand: unique symbol = Symbol(
  "verifiedContainerParentEdge",
);

export interface VerifiedContainerAccessManifest {
  readonly manifest: ContainerAccessManifest;
  readonly manifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly state: ContainerAccessManifestState;
  readonly checkpoint: AccessManifestCheckpoint;
  readonly [verifiedContainerAccessManifestBrand]: true;
}

export interface VerifiedContainerParentEdge {
  readonly childContainerId: string;
  readonly childManifestHash: string;
  readonly parentContainerId: string;
  readonly parentManifestHash: string;
  readonly [verifiedContainerParentEdgeBrand]: true;
}

export function makeVerifiedContainerAccessManifest(
  value: Omit<
    VerifiedContainerAccessManifest,
    typeof verifiedContainerAccessManifestBrand
  >,
): VerifiedContainerAccessManifest {
  return {
    ...value,
    [verifiedContainerAccessManifestBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedContainerParentEdge(
  value: Omit<
    VerifiedContainerParentEdge,
    typeof verifiedContainerParentEdgeBrand
  >,
): VerifiedContainerParentEdge {
  return {
    ...value,
    [verifiedContainerParentEdgeBrand]: verifiedBrandValue,
  };
}

export interface VerifyContainerParentEdgeInput {
  readonly child: VerifiedContainerAccessManifest;
  readonly parentHistory: readonly VerifiedContainerAccessManifest[];
}
