import type { PutPrincipalMemberEnvelopesRequest } from "@tearleads/validators/request";
import type { CurrentPrincipalMemberEnvelopesResponse } from "@tearleads/validators/response";
import { replaceCurrentPrincipalMemberEnvelopes } from "../../access/principalMemberEnvelopes";
import { getCurrentPrincipalState } from "../../access/principalStateStore";
import type { ApiServiceRuntime } from "../runtime";
import {
  PrincipalPolicyError,
  toCurrentPrincipalMemberEnvelopesResponse,
} from "./shared";

function toPrincipalMemberEnvelopeError(
  error: unknown,
): PrincipalPolicyError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message === "Principal member envelopes must target the current state"
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  if (
    error.message ===
      "Principal member envelopes must match the current direct member set" ||
    error.message ===
      "Principal member envelopes must cover the current direct member set" ||
    error.message.startsWith(
      "Principal member envelope targets unknown member",
    ) ||
    error.message.startsWith("Principal member envelope fingerprint mismatch")
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  if (
    error.message.startsWith(
      "Principal member envelope is missing wrapped material",
    )
  ) {
    return new PrincipalPolicyError(error.message, 400);
  }

  if (
    error.message.startsWith("Missing current principal state for ") ||
    error.message === "Principal state not found"
  ) {
    return new PrincipalPolicyError("Principal state not found", 404);
  }

  if (
    error.message.startsWith(
      "Missing user recipient key for principal state member",
    ) ||
    error.message.startsWith(
      "Missing current principal epoch key for group member",
    )
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  return null;
}

/**
 * Stores the current member key envelopes for a principal's active state and
 * returns them in the current-state response shape.
 */
export async function putPrincipalMemberEnvelopes(
  runtime: ApiServiceRuntime,
  input: PutPrincipalMemberEnvelopesRequest & {
    principalType: "group" | "organization";
    principalId: string;
  },
): Promise<CurrentPrincipalMemberEnvelopesResponse> {
  const currentState = await getCurrentPrincipalState(
    input.principalType,
    input.principalId,
    runtime.db,
  );

  if (!currentState) {
    throw new PrincipalPolicyError("Principal state not found", 404);
  }

  try {
    const storedEnvelopes = await replaceCurrentPrincipalMemberEnvelopes(
      {
        principalType: input.principalType,
        principalId: input.principalId,
        stateHash: input.stateHash,
        envelopes: input.envelopes.map((envelope) => ({
          memberPrincipalType: envelope.memberPrincipalType,
          memberPrincipalId: envelope.memberPrincipalId,
          memberKeyFingerprint: envelope.memberKeyFingerprint,
          kemCipherText: envelope.kemCipherText,
          wrappedKey: envelope.wrappedKey,
        })),
      },
      runtime.db,
    );

    return toCurrentPrincipalMemberEnvelopesResponse({
      principalType: input.principalType,
      principalId: input.principalId,
      stateHash: currentState.stateHash,
      epoch: currentState.keyEpoch,
      envelopes: storedEnvelopes,
    });
  } catch (error) {
    const principalPolicyError = toPrincipalMemberEnvelopeError(error);
    if (principalPolicyError) {
      throw principalPolicyError;
    }

    throw error;
  }
}
