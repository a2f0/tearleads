import { describeSchema } from "../jsonSchemaAnnotations";
import {
  CommitOrganizationGroupPolicyRequestSchema,
  CreateOrganizationGroupRequestSchema,
  CreateOrganizationGroupWithPolicyRequestSchema,
  CreateOrganizationRequestSchema,
  DeleteOrganizationGroupRequestSchema,
  OrganizationPrincipalPolicyRequestSchema,
  PrincipalContainerGrantRequestSchema,
  ProvisionedDocumentRequestSchema,
  ProvisionedSystemContainerRequestSchema,
  PutPrincipalPolicyRequestSchema,
  UpdateOrganizationMembershipRequestSchema,
  UpdateOrganizationProfileRequestSchema,
  UpdateOrganizationRosterEntryRequestSchema,
} from "../request";
import {
  CommitOrganizationGroupPolicyConflictResponseSchema,
  CommitOrganizationGroupPolicyResponseSchema,
  CreateOrganizationGroupResponseSchema,
  CreateOrganizationResponseSchema,
  CurrentPrincipalMemberEnvelopesResponseSchema,
  DeleteOrganizationGroupResponseSchema,
  OrganizationDataUsageResponseSchema,
  OrganizationDirectoryUserResponseSchema,
  OrganizationGroupCurrentStateResponseSchema,
  OrganizationGroupMemberResponseSchema,
  OrganizationGroupMembersResponseSchema,
  OrganizationGroupSummaryResponseSchema,
  OrganizationMembershipResponseSchema,
  OrganizationMembershipsResponseSchema,
  OrganizationPolicyHistoryResponseSchema,
  OrganizationPresentationFailureResponseSchema,
  OrganizationProfileResponseSchema,
  OrganizationReadModelFailureResponseSchema,
  OrganizationReadModelResponseSchema,
  PrincipalContainerGrantResponseSchema,
  PrincipalMemberEnvelopeResponseSchema,
  PrincipalPolicyHistorySourceResponseSchema,
  PrincipalPolicyMutationResponseSchema,
  PrincipalPolicyPageResponseSchema,
  PrincipalPolicyReadResponseSchema,
  PrincipalPolicySnapshotPageResponseSchema,
  PrincipalPolicyStaleErrorResponseSchema,
  PrincipalPolicyStateChainEntryResponseSchema,
  PrincipalPolicyUnchangedResponseSchema,
  PrincipalProjectionMemberResponseSchema,
  PrincipalStateExternalAuthorityResponseSchema,
  PrincipalStatePayloadResponseSchema,
  PrincipalStateResponseSchema,
  ProjectionPolicyEvidenceResponseSchema,
  ReferencedPrincipalStateResponseSchema,
} from "../response";
import {
  PrincipalHistoryPreparationFailureResponseSchema,
  PrincipalHistoryPreparationResponseSchema,
} from "../response/principalHistoryPreparation";
import { OrganizationReplacementAuthorizationSchema } from "../util";

describeSchema(
  PrincipalStateResponseSchema,
  "One signed state in a principal policy chain: it commits to the principal's membership, grants, key epoch, encrypted payload, signer, and predecessor.",
  {
    encapsulationPublicKey:
      "The principal's public key at this key epoch; key material for the principal is wrapped to it.",
    externalAuthority:
      "For a group administered by the organization, the exact `Admins` head that authorized this state; null when the state's own policy authorized it.",
    grantCount: "Number of container grants the principal holds.",
    grantRoot:
      "Digest of the sorted container grants; with `grantCount` it authenticates the complete grant list.",
    keyEpoch:
      "The principal's key epoch; envelopes and wraps name the epoch they were made for.",
    keyFingerprint: "Fingerprint of `encapsulationPublicKey`.",
    memberEnvelopesRoot:
      "Digest committing to every member envelope of this key epoch.",
    membershipMode:
      "Always `projection`: membership is the signed projection list.",
    payloadCiphertextHash: "Hash of the state's encrypted payload.",
    prevStateHash: "Hash of the previous state, or null for the first.",
    signature: "ML-DSA-87 signature over the canonical state.",
    signerUserKeyFingerprint: "Signing key fingerprint of the signer.",
    stateHash: "Hash of this signed state; other objects cite the head by it.",
    version: "Position in the chain, starting at 1.",
  },
);

describeSchema(
  PrincipalStateExternalAuthorityResponseSchema,
  "Cites the exact `Admins` group head that authorized a state of an organization-administered group.",
);

describeSchema(
  PrincipalProjectionMemberResponseSchema,
  "One member of a principal and their role.",
);

describeSchema(
  PrincipalContainerGrantResponseSchema,
  "One container grant a principal holds.",
);

describeSchema(
  PrincipalStatePayloadResponseSchema,
  "A principal state's encrypted payload, which only members can read; the signed state commits to its hash.",
  { ciphertextHash: "Hash of `ciphertext`; the signed state commits to it." },
);

describeSchema(
  PrincipalMemberEnvelopeResponseSchema,
  "A member envelope: the principal's key for one key epoch, encapsulated to one member's key.",
  {
    kemCipherText: "ML-KEM-1024 encapsulation to the member's public key.",
    memberKeyFingerprint: "Fingerprint of the member key the envelope targets.",
    wrappedKey:
      "The principal's key for this epoch, encrypted under the encapsulated secret.",
  },
);

describeSchema(
  CurrentPrincipalMemberEnvelopesResponseSchema,
  "Every member envelope of a principal's current key epoch.",
);

describeSchema(
  PrincipalPolicyStateChainEntryResponseSchema,
  "A predecessor state with its membership and grants, so clients can verify the chain step by step.",
);

describeSchema(
  PrincipalPolicyPageResponseSchema,
  "A page of one principal policy chain: the current state with its payload, membership, grants, and member envelopes, plus predecessor states.",
  {
    historyPage:
      "Which predecessor versions this page covers and where the next page starts.",
  },
);

describeSchema(
  PrincipalPolicyUnchangedResponseSchema,
  "The answer to a conditional read whose named head is still current. It is not evidence; the client verifies the head it already holds.",
);

describeSchema(
  PrincipalPolicyReadResponseSchema,
  "A principal policy page, or the short unchanged reply to a conditional read.",
);

describeSchema(
  PrincipalPolicySnapshotPageResponseSchema,
  "A page of public signed policy history, without encrypted payloads or member envelopes.",
  {
    historyPage:
      "Which predecessor versions this page covers and where the next page starts.",
  },
);

describeSchema(
  PrincipalPolicyHistorySourceResponseSchema,
  "Where a client may read one principal's public history: a head and the opaque grant that authorizes the read.",
  {
    grant:
      "Opaque read grant bound to the caller, an object they can read, and this head; it is not verification evidence.",
  },
);

describeSchema(
  ProjectionPolicyEvidenceResponseSchema,
  "Public principal policy history that a projection's manifests depend on, as read sources plus the signed directory payloads they need.",
);

describeSchema(
  ReferencedPrincipalStateResponseSchema,
  "Identifies one principal policy head by version, state hash, and key epoch.",
);

describeSchema(
  PutPrincipalPolicyRequestSchema,
  "The next signed state of a principal policy with everything it commits to.",
  {
    containerMutations:
      "Container mutations that move the principal's grants to the new key epoch, committed atomically with it.",
    encryptedPayload: "Encrypted payload, such as the group's name.",
    grants: "The principal's complete container grant list after this state.",
    memberEnvelopes: "The new key epoch's key, encapsulated to each member.",
    projection: "The complete membership with roles after this state.",
    state: "The signed state.",
  },
);

describeSchema(
  OrganizationPrincipalPolicyRequestSchema,
  "The organization's next signed principal policy state, including its signed directory of group heads.",
  {
    containerMutations:
      "Container mutations committed atomically with the state.",
    memberEnvelopes: "The new key epoch's key, encapsulated to each member.",
    projection: "The complete membership with roles after this state.",
  },
);

describeSchema(
  PrincipalContainerGrantRequestSchema,
  "One container grant in a principal's grant list.",
);

describeSchema(
  CommitOrganizationGroupPolicyRequestSchema,
  "A group's next policy state committed together with the organization policy successor that records its new head.",
  {
    groupPolicy: "The group's next signed state.",
    memberPolicy:
      "Successor of the reserved `Members` group, when the change also enrolls users in the organization.",
    organizationPolicy:
      "The organization's next signed state, whose directory names the group's new head.",
  },
);

describeSchema(
  CommitOrganizationGroupPolicyResponseSchema,
  "Acknowledges a group policy commit with the head of every policy it advanced.",
);

describeSchema(
  CommitOrganizationGroupPolicyConflictResponseSchema,
  "A group policy commit refused because the container mutations it carries are stale.",
);

describeSchema(
  PrincipalPolicyMutationResponseSchema,
  "Acknowledges a principal policy write by the head it committed rather than an echo of the signed request. The caller rebuilds the acknowledged state and artifacts from its own request.",
  {
    containerMutations:
      "Hash-form acknowledgements of the container mutations committed with the policy, in request order.",
    createdAt:
      "Server-assigned insertion time of the stored state and its payload; the only acknowledged field the request does not carry.",
    head: "The committed head; it must equal the head the caller computes from its own signed state.",
  },
);

describeSchema(
  PrincipalPolicyStaleErrorResponseSchema,
  "A 409 because a cited principal policy is no longer current.",
  {
    principalHeads:
      "Current heads of the cited principals that the caller may read.",
  },
);

describeSchema(
  PrincipalHistoryPreparationResponseSchema,
  "A 202: the operation rolled back while the server prepares principal history. Retry the identical request.",
  {
    progressToken:
      "Changes when preparation advances; clients stop after three identical tokens in a row.",
  },
);

describeSchema(
  PrincipalHistoryPreparationFailureResponseSchema,
  "A 503. Only with code `principal_history_preparation_unavailable` and `committed: false` does it prove nothing was written; any other 503 has an unknown outcome.",
);

describeSchema(
  CreateOrganizationRequestSchema,
  "Every signed artifact of a new organization, signed with the caller's existing identity: the same set registration provisions.",
  {
    nativeSubscriptionRestore:
      "Marks the new organization as the destination of a native store subscription restore.",
    replacementAuthorization:
      "Identity-signed authorization for the new organization to replace a purged personal organization.",
    replacesOrganizationId:
      "Purged personal organization this one replaces; accepted only after that purge completed.",
    finalizeReplacement:
      "Completes an earlier replacement after the client reset its local copy, moving the user's default organization to it.",
  },
);

describeSchema(
  CreateOrganizationResponseSchema,
  "Acknowledges a new organization by the ids and hashes of what it created.",
  {
    committedCoreMetadataUpdateIds:
      "Ids of the seeded metadata updates the server committed.",
    committedProfileUpdateIds:
      "Ids of the seeded profile updates the server committed.",
    rootMetadataAccessEpoch:
      "Access epoch of the root container's metadata document.",
    rootMetadataAccessStateHash:
      "Access state hash of the root container's metadata document.",
    replacementAuthorization:
      "For a replacement, the identity-signed authorization clients verify before following it.",
  },
);

describeSchema(
  ProvisionedSystemContainerRequestSchema,
  "A system container created during provisioning, with its metadata document.",
  {
    systemSlot: "Opaque id of the container's system role.",
    initialMetadataSync:
      "The metadata document's first update, committed with the provisioning.",
  },
);

describeSchema(
  ProvisionedDocumentRequestSchema,
  "A document created during provisioning, with its first update.",
  {
    initialSync:
      "The document's first update, committed with the provisioning.",
  },
);

describeSchema(
  OrganizationReplacementAuthorizationSchema,
  "An identity's signed statement that one fresh personal organization replaces a purged one, binding the new organization's root and reserved group heads.",
  { signature: "The identity's ML-DSA-87 signature over the other fields." },
);

describeSchema(
  CreateOrganizationGroupRequestSchema,
  "A new group's id and first signed policy.",
);

describeSchema(
  CreateOrganizationGroupWithPolicyRequestSchema,
  "A new group with its first signed policy and the organization policy successor that adds it to the directory.",
);

describeSchema(
  CreateOrganizationGroupResponseSchema,
  "Acknowledges a new group and the organization policy that lists it.",
);

describeSchema(
  DeleteOrganizationGroupRequestSchema,
  "The organization policy successor that drops a group from the directory.",
);

describeSchema(
  DeleteOrganizationGroupResponseSchema,
  "Confirms a group deletion and the organization policy that recorded it.",
);

describeSchema(
  OrganizationGroupCurrentStateResponseSchema,
  "A group's current policy head.",
);

describeSchema(
  OrganizationGroupSummaryResponseSchema,
  "A group of an organization and its current head.",
  { isBuiltin: "True for the reserved `Admins` and `Members` groups." },
);

describeSchema(
  OrganizationGroupMemberResponseSchema,
  "One member of a group, with their registered keys when known.",
);

describeSchema(
  OrganizationGroupMembersResponseSchema,
  "The members of a group from its current signed policy.",
);

describeSchema(
  OrganizationDirectoryUserResponseSchema,
  "One organization roster entry with the user's registered keys. Display names live in the encrypted profile document.",
  {
    disabledByUserId: "Administrator who disabled the entry, or null.",
    isPersonalOrganizationOwner:
      "True for the user whose personal organization this is; they cannot be removed from it.",
    isSelf: "True for the caller's own entry.",
    leaveRequest:
      "The member's pending signed request to leave, shown only to administrators and the member.",
    profileDocumentId: "Encrypted roster profile document, or null.",
    status:
      "`active` members have access; `disabled` entries stay visible without access.",
  },
);

describeSchema(
  OrganizationProfileResponseSchema,
  "The organization's encrypted profile document binding.",
);

describeSchema(
  UpdateOrganizationProfileRequestSchema,
  "Binds or clears the organization's encrypted profile document.",
);

describeSchema(
  UpdateOrganizationRosterEntryRequestSchema,
  "Binds or clears a roster entry's encrypted profile document.",
);

describeSchema(
  UpdateOrganizationMembershipRequestSchema,
  "The caller's own setting for one organization they belong to.",
  {
    syncPaused:
      "True to stop this organization's content syncing to the caller's devices; access and keys are unchanged.",
  },
);

describeSchema(
  OrganizationMembershipResponseSchema,
  "One organization the caller belongs to, as the caller's own settings for it; it grants nothing.",
  {
    isPersonalOrganizationOwner:
      "True for the caller's personal organization, which can be neither paused nor left.",
    leaveRequestedAt: "When the caller asked to leave, or null.",
    syncPaused:
      "True when the caller paused this organization's sync to their devices.",
  },
);

describeSchema(
  OrganizationMembershipsResponseSchema,
  "Every organization where the caller has an active roster entry.",
);

// OrganizationLeaveRequest is deliberately undescribed: it sits inside an inline anyOf/oneOf
// branch of OrganizationReadModelResponse, and the pinned oasdiff reports any description change
// in such a branch's resolved subtree as a breaking branch replacement.

describeSchema(
  OrganizationReadModelResponseSchema,
  "A page of the organization read model: an atomic snapshot when the request had no cursor, otherwise only the lanes changed since it. Display data only, never authority.",
);

describeSchema(
  OrganizationReadModelFailureResponseSchema,
  "A refused read-model request.",
  {
    code: "Present only when the API identified the cursor as invalid, which lets the client discard it and request a snapshot.",
  },
);

describeSchema(
  OrganizationPresentationFailureResponseSchema,
  "The caller may not see this organization's data.",
);

describeSchema(
  OrganizationPolicyHistoryResponseSchema,
  "A page of an organization's signed policy history up to an exact head. Signed evidence only; clients resolve display names themselves.",
  {
    stateHash: "The organization head the history ends at.",
    nextBeforeVersion: "Cursor for the next page, or null on the last page.",
  },
);

describeSchema(
  OrganizationDataUsageResponseSchema,
  "How much an organization stores, by documents and blobs.",
  { totalByteLength: "Document plus blob bytes." },
);
