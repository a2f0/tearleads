import {
  buildPrincipalStateSigningInput,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
  type PrincipalContainerGrant,
  type PrincipalPolicyExternalAuthority,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type {
  CreateOrganizationGroupRequest,
  PrincipalMemberEnvelopeRequest,
  PrincipalProjectionMemberRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

interface BuildInitialGroupPolicyInput {
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly externalAuthority?:
    | PrincipalPolicyExternalAuthority["currentHead"]
    | null;
  readonly groupId: string;
  readonly grants?: readonly PrincipalContainerGrant[] | undefined;
  readonly includeSignerAsAdmin?: boolean;
  readonly name: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}

export function userProjectionMember(
  userId: string,
  role: "member" | "admin",
): PrincipalProjectionMemberRequest {
  return { userId: userId, role };
}

function projectionToStateMembers(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
) {
  return projection.map((member) => ({ userId: member.userId }));
}

/**
 * The group's display name rides in the signed payload. The server keeps a
 * mutable `name` column for listings, but a share must land on the group the
 * user saw, so the name shown at share time is checked against this committed
 * copy rather than the read model.
 */
function payloadCiphertextForProjection(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
  name: string,
): string {
  return bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection, name })),
  );
}

/**
 * The comparison key for a group display name: width- and compatibility-
 * normalized, stripped of control and format characters (zero-width joiners
 * and the like), whitespace-collapsed, and case-folded. Two names that a user
 * cannot tell apart in a picker must compare equal, or a look-alike name would
 * slip past the share-time binding. Cross-script homoglyphs (Latin "A" against
 * Greek "Α") are not folded: that needs the UTS #39 confusables table, and both
 * names would still have to be signed groups the organization's own admins
 * created.
 */
export function canonicalGroupNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

/** The display name committed in a group policy's signed payload. */
export function readGroupPolicyPayloadName(
  bundle: PrincipalPolicyBundleResponse,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder().decode(base64ToBytes(bundle.currentPayload.ciphertext)),
    );
  } catch {
    throw new KeyingVerificationError(
      "invalid_shape",
      "Group policy payload is not canonical JSON",
    );
  }
  const name =
    parsed !== null && typeof parsed === "object"
      ? Reflect.get(parsed, "name")
      : undefined;
  if (typeof name !== "string" || name.trim().length === 0) {
    // Flag-day: groups signed before display names were committed cannot be
    // mutated or shared by name; the organization must be reprovisioned.
    throw new KeyingVerificationError(
      "invalid_shape",
      "Group policy payload does not commit a display name; groups signed before this protocol version must be reprovisioned",
    );
  }
  return name;
}

export async function signedGroupPolicyRequest(input: {
  readonly currentPolicy?: PrincipalPolicyBundleResponse;
  readonly encapsulationPublicKey: string;
  readonly externalAuthority:
    | PrincipalPolicyExternalAuthority["currentHead"]
    | null;
  readonly keyEpoch: number;
  readonly keyFingerprint: string;
  readonly grants: ReadonlyArray<PrincipalContainerGrant>;
  readonly memberEnvelopes: ReadonlyArray<PrincipalMemberEnvelopeRequest>;
  readonly name: string;
  readonly principalId: string;
  readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
  readonly signedAt: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PutPrincipalPolicyRequest> {
  const projection = normalizePrincipalProjectionMembers(input.projection);
  const grants = normalizePrincipalContainerGrants(input.grants);
  const payloadCiphertext = payloadCiphertextForProjection(
    projection,
    input.name,
  );
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: input.principalId,
      version: input.currentPolicy
        ? input.currentPolicy.currentState.version + 1
        : 1,
      prevStateHash: input.currentPolicy?.currentState.stateHash ?? null,
      keyEpoch: input.keyEpoch,
      encapsulationPublicKey: input.encapsulationPublicKey,
      keyFingerprint: input.keyFingerprint,
      members: projectionToStateMembers(projection),
      memberEnvelopes: [...input.memberEnvelopes],
      projection,
      grants,
      payloadCiphertext,
      externalAuthority: input.externalAuthority,
      signedAt: input.signedAt,
      signerUserId: input.signerUserId,
      signerUserKeyFingerprint: input.signingFingerprint,
    }),
    input.signingKeyPair.signingPrivateKey,
  );

  return {
    state,
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
    projection,
    grants,
    memberEnvelopes: [...input.memberEnvelopes],
  };
}

export async function buildInitialGroupPolicyRequest(
  input: BuildInitialGroupPolicyInput,
): Promise<CreateOrganizationGroupRequest> {
  const groupKem = generateKemSeedAndKeyPair();
  const withSigner = input.includeSignerAsAdmin ?? true;
  const projection = withSigner
    ? [userProjectionMember(input.signerUserId, "admin")]
    : [];
  const memberEnvelopes: PrincipalMemberEnvelopeRequest[] = [];

  if (withSigner) {
    const creatorFingerprint = await toFingerprint(
      input.creatorEncapsulationKeyPair.publicKey,
    );
    const [creatorEnvelope] = await wrapDekForRecipients(groupKem.secretKey, [
      input.creatorEncapsulationKeyPair.publicKey,
    ]);

    if (!creatorEnvelope) {
      throw new Error("Failed to wrap group key for creator");
    }

    memberEnvelopes.push({
      userId: input.signerUserId,
      memberKeyFingerprint: creatorFingerprint,
      kemCipherText: bytesToBase64(creatorEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(creatorEnvelope.wrappedKey),
    });
  }
  const name = input.name.trim();
  // A name is compared by canonical key but displayed raw, so control and
  // format characters (bidi overrides, zero-width joiners, newlines) would let
  // one signed name render as another. A lone surrogate would be re-encoded
  // as U+FFFD in the signed payload and no longer match the name sent to the
  // server. Refuse all of them where the name is signed. This deliberately
  // refuses U+200D too, so ZWJ emoji sequences cannot name a group: a label
  // is an identifier here, and no format character may hide in one.
  if (name.length === 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(name)) {
    throw new Error(
      "Group names must be non-empty and contain no control, format, or surrogate characters",
    );
  }
  const policyRequest = await signedGroupPolicyRequest({
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    externalAuthority: input.externalAuthority ?? null,
    keyEpoch: 1,
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    grants: input.grants ?? [],
    memberEnvelopes,
    name,
    principalId: input.groupId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });

  return {
    groupId: input.groupId,
    name,
    initialGroupPolicy: policyRequest,
  };
}

/**
 * Members at bootstrap holds the registering user alone.
 *
 * It used to also contain the Admins group as a nested member, so that admins
 * were implicitly members. Principals contain only users now, so an admin is an
 * ordinary Members entry — and bootstrap has exactly one user, who is that
 * admin.
 */
export async function buildInitialMemberGroupPolicyRequest(input: {
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly groupId: string;
  readonly grants?: readonly PrincipalContainerGrant[] | undefined;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<CreateOrganizationGroupRequest> {
  return buildInitialGroupPolicyRequest({ ...input, name: "Members" });
}
