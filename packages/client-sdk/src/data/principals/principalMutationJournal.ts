import {
  KeyingVerificationError,
  type SigningKeyPair,
  sign,
  toFingerprint,
  verify,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  type CommitOrganizationGroupPolicyRequest,
  CommitOrganizationGroupPolicyRequestSchema,
} from "@tearleads/validators/request";
import { canonicalKeyingJsonString } from "../keyingCanonicalJson";
import type { PrincipalMutationJournalRow } from "../persistence/principalMutationJournalPersistence";

export interface PrincipalMutationJournalScope {
  readonly identityTrustDomain: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly signingFingerprint: string;
}

export interface AuthoredPrincipalMutation {
  readonly groupId: string;
  readonly request: CommitOrganizationGroupPolicyRequest;
}

const journalDomain = "tearleads.sdk.principal-mutation.v1";
const encoder = new TextEncoder();

function scopeJson(scope: PrincipalMutationJournalScope): string {
  const values = [
    scope.identityTrustDomain,
    scope.organizationId,
    scope.userId,
    scope.signingFingerprint,
  ];
  if (values.some((value) => typeof value !== "string" || value.length === 0))
    throw new Error("Principal mutation journal requires a complete scope");
  return JSON.stringify([journalDomain, ...values]);
}

export async function principalMutationJournalScopeId(
  scope: PrincipalMutationJournalScope,
): Promise<string> {
  return bytesToBase64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(scopeJson(scope))),
    ),
  );
}

function readMutation(
  value: unknown,
  scope: PrincipalMutationJournalScope,
): AuthoredPrincipalMutation {
  if (typeof value !== "object" || value === null)
    throw new Error("Principal mutation journal payload is invalid");
  const groupId: unknown = Reflect.get(value, "groupId");
  const request = CommitOrganizationGroupPolicyRequestSchema.parse(
    Reflect.get(value, "request"),
  );
  const group = request.groupPolicy.state;
  const organization = request.organizationPolicy.state;
  if (
    typeof groupId !== "string" ||
    group.principalType !== "group" ||
    group.principalId !== groupId ||
    organization.principalType !== "organization" ||
    organization.principalId !== scope.organizationId ||
    [group, organization].some(
      (state) =>
        state.signerUserId !== scope.userId ||
        state.signerUserKeyFingerprint !== scope.signingFingerprint,
    )
  )
    throw new Error("Principal mutation journal target or signer differs");
  return { groupId, request };
}

function signedBytes(scope: PrincipalMutationJournalScope, request: string) {
  return encoder.encode(JSON.stringify([scopeJson(scope), request]));
}

/** Sign the complete wire body, including artifacts outside policy signatures. */
export async function sealPrincipalMutation(input: {
  readonly scope: PrincipalMutationJournalScope;
  readonly mutation: AuthoredPrincipalMutation;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PrincipalMutationJournalRow> {
  const scope = { ...input.scope };
  const mutation = readMutation(
    JSON.parse(JSON.stringify(input.mutation)),
    scope,
  );
  const serializedRequest = canonicalKeyingJsonString(
    mutation,
    "authored principal mutation",
  );
  const publicKey = new Uint8Array(input.signingKeyPair.signingPublicKey);
  const privateKey = new Uint8Array(input.signingKeyPair.signingPrivateKey);
  try {
    if ((await toFingerprint(publicKey)) !== scope.signingFingerprint)
      throw new Error("Principal mutation journal signing key differs");
    return {
      scopeId: await principalMutationJournalScopeId(scope),
      organizationId: scope.organizationId,
      serializedRequest,
      signature: bytesToBase64(
        sign(signedBytes(scope, serializedRequest), privateKey),
      ),
    };
  } finally {
    privateKey.fill(0);
  }
}

/** Authentication precedes parsing or submission; corrupt authored work is retained. */
export async function openPrincipalMutation(input: {
  readonly scope: PrincipalMutationJournalScope;
  readonly row: PrincipalMutationJournalRow;
  readonly signingPublicKey: Uint8Array;
}): Promise<AuthoredPrincipalMutation> {
  const scope = { ...input.scope };
  const row = { ...input.row };
  const publicKey = new Uint8Array(input.signingPublicKey);
  try {
    if (
      row.organizationId !== scope.organizationId ||
      row.scopeId !== (await principalMutationJournalScopeId(scope)) ||
      (await toFingerprint(publicKey)) !== scope.signingFingerprint ||
      !verify(
        base64ToBytes(row.signature),
        signedBytes(scope, row.serializedRequest),
        publicKey,
      )
    )
      throw new Error("Principal mutation journal authentication failed");
    return readMutation(JSON.parse(row.serializedRequest), scope);
  } catch {
    throw new KeyingVerificationError(
      "signature_mismatch",
      "Saved principal mutation could not be authenticated",
    );
  }
}
