import type {
  VerifiedAccessEvent,
  VerifyAccessEventInput,
} from "./accessEventTypes";
import type { VerifiedContainerAccessManifest } from "./containerAccessTypes";
import type { VerifiedDocumentLinkSetManifest } from "./documentAccessTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";
import type { PrincipalPolicyAuthorization } from "./principalPolicyTypes";

export interface AttachmentBindAccessEventBody {
  eventType: "attachment.bind";
  bindingId: string;
  blobId: string;
  documentId: string;
  slotId: string;
  expectedBindingId: string | null;
  documentManifestHash: string;
}

export interface AttachmentDetachAccessEventBody {
  eventType: "attachment.detach";
  bindingId: string;
  blobId: string;
  documentId: string;
  slotId: string;
  documentManifestHash: string;
}

export type AttachmentAccessEventBody =
  | AttachmentBindAccessEventBody
  | AttachmentDetachAccessEventBody;

const verifiedAttachmentBindingBrand: unique symbol = Symbol(
  "verifiedAttachmentBinding",
);
const verifiedAttachmentDetachBrand: unique symbol = Symbol(
  "verifiedAttachmentDetach",
);

export interface VerifiedAttachmentBinding {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentId: string;
  readonly slotId: string;
  readonly documentManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly body: AttachmentBindAccessEventBody;
  readonly [verifiedAttachmentBindingBrand]: true;
}

export interface VerifiedAttachmentDetach {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentId: string;
  readonly slotId: string;
  readonly documentManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly body: AttachmentDetachAccessEventBody;
  readonly [verifiedAttachmentDetachBrand]: true;
}

export function makeVerifiedAttachmentBinding(
  value: Omit<VerifiedAttachmentBinding, typeof verifiedAttachmentBindingBrand>,
): VerifiedAttachmentBinding {
  return {
    ...value,
    [verifiedAttachmentBindingBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedAttachmentDetach(
  value: Omit<VerifiedAttachmentDetach, typeof verifiedAttachmentDetachBrand>,
): VerifiedAttachmentDetach {
  return {
    ...value,
    [verifiedAttachmentDetachBrand]: verifiedBrandValue,
  };
}

export interface VerifyAttachmentBindingEventInput
  extends VerifyAccessEventInput {
  readonly authorizationMembership?: "current" | "referenced";
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly authorizingContainerPaths?: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies?: readonly PrincipalPolicyAuthorization[];
  readonly expectedBindingId?: string;
  readonly expectedBlobId?: string;
  readonly expectedDocumentId?: string;
  readonly expectedDocumentManifestHash?: string;
  readonly expectedPreviousBindingId?: string | null;
}

export interface VerifyAttachmentDetachEventInput
  extends VerifyAccessEventInput {
  readonly authorizationMembership?: "current" | "referenced";
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly authorizingContainerPaths?: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies?: readonly PrincipalPolicyAuthorization[];
  readonly expectedBindingId?: string;
  readonly expectedBlobId?: string;
  readonly expectedDocumentId?: string;
  readonly expectedDocumentManifestHash?: string;
}
