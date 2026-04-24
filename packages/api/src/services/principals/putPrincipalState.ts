import type { PutPrincipalStateRequest } from "@tearleads/validators/request";
import type { PrincipalStateResponse } from "@tearleads/validators/response";
import { storeVerifiedPrincipalState } from "../../access/principalStateStore";
import type { ApiServiceRuntime } from "../runtime";
import { PrincipalPolicyError, toPrincipalStateResponse } from "./shared";

interface PutPrincipalStateInput extends PutPrincipalStateRequest {
  expectedPrincipalId: string;
  expectedPrincipalType: "group" | "organization";
}

function toPrincipalStateError(error: unknown): PrincipalPolicyError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (error.message === "Invalid principal state signature") {
    return new PrincipalPolicyError(error.message, 403);
  }

  if (
    error.message === "Principal state version conflict" ||
    error.message === "Principal epoch key conflict" ||
    error.message === "Principal state previous hash mismatch" ||
    error.message === "Principal state payload conflict" ||
    error.message === "Principal state projection conflict"
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  if (
    error.message ===
      "Principal state payload ciphertext hash does not match ciphertext" ||
    error.message ===
      "Principal state payloadCiphertextHash does not match encrypted payload" ||
    error.message ===
      "Principal state projectionRoot does not match projection" ||
    error.message === "Principal state memberCount does not match projection"
  ) {
    return new PrincipalPolicyError(error.message, 400);
  }

  return null;
}

export async function putPrincipalState(
  runtime: ApiServiceRuntime,
  input: PutPrincipalStateInput,
): Promise<PrincipalStateResponse> {
  if (input.state.principalType !== input.expectedPrincipalType) {
    throw new PrincipalPolicyError(
      "Principal state principalType does not match route principal",
      400,
    );
  }

  if (input.state.principalId !== input.expectedPrincipalId) {
    throw new PrincipalPolicyError(
      "Principal state principalId does not match route principal",
      400,
    );
  }

  const trustedSignerPublicKey =
    await runtime.principalSignerTrustStore.getTrustedSignerPublicKey(
      input.state.signerKeyId,
    );

  if (!trustedSignerPublicKey) {
    throw new PrincipalPolicyError("Untrusted principal state signer", 403);
  }

  try {
    const storedState = await storeVerifiedPrincipalState(
      {
        state: {
          principalType: input.state.principalType,
          principalId: input.state.principalId,
          version: input.state.version,
          prevStateHash: input.state.prevStateHash,
          keyEpoch: input.state.keyEpoch,
          encapsulationPublicKey: input.state.encapsulationPublicKey,
          keyFingerprint: input.state.keyFingerprint,
          membershipMode: input.state.membershipMode,
          membershipRoot: input.state.membershipRoot,
          projectionRoot: input.state.projectionRoot,
          payloadCiphertextHash: input.state.payloadCiphertextHash,
          memberCount: input.state.memberCount,
          signedAt: input.state.signedAt,
          signerKeyId: input.state.signerKeyId,
          signature: input.state.signature,
        },
        encryptedPayload: {
          cipherSuite: input.encryptedPayload.cipherSuite,
          ciphertext: input.encryptedPayload.ciphertext,
          ciphertextHash: input.encryptedPayload.ciphertextHash,
        },
        projection: input.projection.map((member) => ({
          memberPrincipalType: member.memberPrincipalType,
          memberPrincipalId: member.memberPrincipalId,
          role: member.role,
        })),
      },
      trustedSignerPublicKey,
      runtime.db,
    );

    return toPrincipalStateResponse(storedState);
  } catch (error) {
    const principalPolicyError = toPrincipalStateError(error);
    if (principalPolicyError) {
      throw principalPolicyError;
    }

    throw error;
  }
}
