import { computePrincipalStatePayloadCiphertextHash } from "../principalState";
import type { PrincipalPolicyBundle } from "./principalPolicyTypes";
import { throwVerification } from "./shared";

/** The payload's ciphertext hashes to the state's signed commitment. */
export async function verifyPrincipalPolicyPayload(input: {
  readonly bundle: Pick<
    PrincipalPolicyBundle,
    "currentState" | "currentPayload"
  >;
}): Promise<void> {
  const { currentPayload, currentState } = input.bundle;
  if (
    (await computePrincipalStatePayloadCiphertextHash(
      currentPayload.ciphertext,
    )) !== currentState.payloadCiphertextHash
  ) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload hash does not match current state",
    );
  }
}
