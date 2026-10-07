import {
  KeyingVerificationError,
  type SigningKeyPair,
  sign,
  toFingerprint,
  verify,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { canonicalKeyingJsonString } from "../keyingCanonicalJson";
import type { PrincipalMutationJournalRow } from "../persistence/principalMutationJournalPersistence";

import {
  type AuthoredPrincipalMutation,
  readPrincipalMutation,
} from "./principalMutationJournalShape";

export interface PrincipalMutationJournalScope {
  readonly identityTrustDomain: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly signingFingerprint: string;
}

export type { AuthoredPrincipalMutation } from "./principalMutationJournalShape";

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

function signedBytes(scope: PrincipalMutationJournalScope, request: string) {
  // The domain-tagged scope and JSON tuple separate these identity-key
  // signatures from policy state signatures and other authored formats.
  return encoder.encode(JSON.stringify([scopeJson(scope), request]));
}

/** Sign the complete wire body, including artifacts outside policy signatures. */
export async function sealPrincipalMutation(input: {
  readonly scope: PrincipalMutationJournalScope;
  readonly mutation: AuthoredPrincipalMutation;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PrincipalMutationJournalRow> {
  const scope = { ...input.scope };
  const mutation = readPrincipalMutation(
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
  } catch {
    throw new KeyingVerificationError(
      "signature_mismatch",
      "Saved principal mutation could not be authenticated",
    );
  }
  try {
    return readPrincipalMutation(JSON.parse(row.serializedRequest), scope);
  } catch {
    throw new KeyingVerificationError(
      "invalid_shape",
      "Authenticated principal mutation has an unsupported or invalid format",
    );
  }
}
