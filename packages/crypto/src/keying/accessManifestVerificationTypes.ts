import type { AccessObjectKind, VerifiedAccessEvent } from "./accessEventTypes";
import type {
  AccessManifest,
  AccessManifestCheckpoint,
  VerifiedAccessManifest,
} from "./accessManifestTypes";
import type { VerifiedContainerAccessManifest } from "./containerAccessTypes";
import type {
  VerifiedDocumentLinkSetManifest,
  VerifiedDocumentLinkSetStateEvidence,
} from "./documentAccessTypes";
import type { PrincipalPolicyAuthorization } from "./principalPolicyTypes";

export type AnyVerifiedAccessManifest =
  | VerifiedAccessManifest
  | VerifiedContainerAccessManifest
  | VerifiedDocumentLinkSetManifest;

interface ExpectedObject {
  readonly objectKind: AccessObjectKind;
  readonly objectId: string;
}

export interface VerifyAccessManifestInput {
  readonly manifest: AccessManifest;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly expectedObject?: ExpectedObject;
  readonly expectedPreviousManifestHash?: string | null;
  readonly localCheckpoint?: AccessManifestCheckpoint | null | undefined;
  readonly checkpointPredecessors?:
    | readonly AnyVerifiedAccessManifest[]
    | undefined;
}

export interface VerifyContainerAccessManifestInput {
  readonly authorizationMembership?: "current" | "referenced" | undefined;
  readonly manifest: AccessManifest;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest?: VerifiedContainerAccessManifest | null;
  readonly localCheckpoint?: AccessManifestCheckpoint | null | undefined;
  readonly checkpointPredecessors?:
    | readonly AnyVerifiedAccessManifest[]
    | undefined;
  readonly previousContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly parentContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly destinationParentContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicies?: readonly PrincipalPolicyAuthorization[];
}

export interface VerifyDocumentLinkSetManifestInput {
  readonly authorizationMembership?: "current" | "referenced" | undefined;
  readonly manifest: AccessManifest;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest?: VerifiedDocumentLinkSetStateEvidence | null;
  readonly localCheckpoint?: AccessManifestCheckpoint | null | undefined;
  readonly checkpointPredecessors?:
    | readonly AnyVerifiedAccessManifest[]
    | undefined;
  readonly targetContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly authorizingContainerPaths?: readonly VerifiedContainerAccessManifest[][];
  readonly principalPolicies?: readonly PrincipalPolicyAuthorization[];
}
