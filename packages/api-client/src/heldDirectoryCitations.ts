import {
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
} from "@tearleads/crypto";
import {
  isPrincipalStatePayloadResponse,
  isPrincipalStateResponse,
  type PrincipalStatePayloadResponse,
  type PrincipalStateResponse,
} from "@tearleads/validators/response";
import { isSha256HexString } from "@tearleads/validators/util";

/**
 * An organization directory payload a device holds, beside the signed state
 * that commits its hash. Writer projections serve directory payloads as
 * policy evidence; a request may cite a held one by state hash instead.
 */
export interface HeldDirectoryCitation {
  readonly directoryState: PrincipalStateResponse;
  readonly directoryPayload: PrincipalStatePayloadResponse;
}

export function isHeldDirectoryCitation(
  value: unknown,
): value is HeldDirectoryCitation {
  return (
    typeof value === "object" &&
    value !== null &&
    isPrincipalStateResponse(Reflect.get(value, "directoryState")) &&
    isPrincipalStatePayloadResponse(Reflect.get(value, "directoryPayload"))
  );
}

/**
 * The payload, under its state hash, when its organization state recomputes
 * to its own hash and its bytes hash to the `payloadCiphertextHash` that
 * state signs; null otherwise. A payload is only its ciphertext (#2903 P23),
 * so the signed hash is its whole identity: a cited payload is exactly the
 * bytes the server would serve for that state, and verification of the
 * rebuilt evidence decides as if they had travelled.
 */
export async function signedDirectoryPayload(
  citation: HeldDirectoryCitation,
): Promise<{
  readonly payload: PrincipalStatePayloadResponse;
  readonly stateHash: string;
} | null> {
  const { directoryState: state, directoryPayload: payload } = citation;
  try {
    if (
      state.principalType !== "organization" ||
      !isSha256HexString(state.stateHash) ||
      (await computePrincipalStateHash(state)) !== state.stateHash
    )
      return null;
    return (await computePrincipalStatePayloadCiphertextHash(
      payload.ciphertext,
    )) === state.payloadCiphertextHash
      ? { payload, stateHash: state.stateHash }
      : null;
  } catch {
    return null;
  }
}
