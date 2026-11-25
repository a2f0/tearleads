import type { VerifiedContainerAccessManifest } from "../containerAccess/containerAccessTypes";
import type {
  VerifiedDocumentLinkSetManifest,
  VerifiedDocumentLinkSetStateEvidence,
} from "../documentAccess/documentAccessTypes";
import type { PrincipalPolicyAuthorization } from "../principalPolicy/principalPolicyTypes";
import type { AccessObjectKind, VerifiedAccessEvent } from "./accessEventTypes";
import type {
  AccessManifest,
  AccessManifestCheckpoint,
  VerifiedAccessManifest,
} from "./accessManifestTypes";

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
  /**
   * The manifest as received; omitted when the caller has only the expected
   * hash, in which case the manifest derived from the state is verified
   * against that hash.
   */
  readonly manifest?: AccessManifest | undefined;
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
  /** As for a container: omitted, the derived manifest is verified. */
  readonly manifest?: AccessManifest | undefined;
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
