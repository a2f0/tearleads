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
    error.message === "Principal epoch key conflict"
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  return null;
}

export async function putPrincipalState(
  runtime: ApiServiceRuntime,
  input: PutPrincipalStateInput,
): Promise<PrincipalStateResponse> {
  if (input.principalType !== input.expectedPrincipalType) {
    throw new PrincipalPolicyError(
      "Principal state principalType does not match route principal",
      400,
    );
  }

  if (input.principalId !== input.expectedPrincipalId) {
    throw new PrincipalPolicyError(
      "Principal state principalId does not match route principal",
      400,
    );
  }

  const trustedSignerPublicKey =
    await runtime.principalSignerTrustStore.getTrustedSignerPublicKey(
      input.signerKeyId,
    );

  if (!trustedSignerPublicKey) {
    throw new PrincipalPolicyError("Untrusted principal state signer", 403);
  }

  try {
    const storedState = await storeVerifiedPrincipalState(
      {
        principalType: input.principalType,
        principalId: input.principalId,
        version: input.version,
        prevStateHash: input.prevStateHash,
        keyEpoch: input.keyEpoch,
        encapsulationPublicKey: input.encapsulationPublicKey,
        keyFingerprint: input.keyFingerprint,
        members: input.members.map((member) => ({
          principalType: member.principalType,
          principalId: member.principalId,
        })),
        membershipRoot: input.membershipRoot,
        signedAt: input.signedAt,
        signerKeyId: input.signerKeyId,
        signature: input.signature,
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
