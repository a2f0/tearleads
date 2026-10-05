import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalPolicySignerPublicKey } from "@tearleads/crypto";
import type { PrincipalPolicySnapshotResponse } from "@tearleads/validators/response";
import { loadSignerPublicKey } from "../signerPublicKey";
import { PrincipalPolicyError } from "./shared";

function principalPolicyStates(
  bundle: PrincipalPolicySnapshotResponse,
): PrincipalPolicySnapshotResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

export async function loadPolicySignerPublicKeys(
  executor: DatabaseSession,
  bundle: PrincipalPolicySnapshotResponse,
): Promise<PrincipalPolicySignerPublicKey[]> {
  const keys = new Map<string, PrincipalPolicySignerPublicKey>();
  for (const state of principalPolicyStates(bundle)) {
    const key = `${state.signerUserId}:${state.signerUserKeyFingerprint}`;
    if (keys.has(key)) {
      continue;
    }
    const signingPublicKey = await loadSignerPublicKey(executor, {
      error: () =>
        new PrincipalPolicyError(
          "Stored principal policy signer is missing or inconsistent",
          409,
        ),
      fingerprint: state.signerUserKeyFingerprint,
      userId: state.signerUserId,
    });
    keys.set(key, {
      userId: state.signerUserId,
      signingKeyFingerprint: state.signerUserKeyFingerprint,
      signingPublicKey,
    });
  }
  return [...keys.values()];
}
