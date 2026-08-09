import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalPolicySignerPublicKey } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { loadSignerPublicKey } from "../signerPublicKey";
import { buildPrincipalPolicyForStateWithExecutor } from "./principalPolicyBundleRecords";
import { PrincipalPolicyError } from "./shared";

interface ExternalAuthorityVerificationSource {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}

export interface StoredPrincipalPolicyVerificationSource {
  readonly authority: ExternalAuthorityVerificationSource | null;
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}

function principalPolicyStates(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

async function loadPolicySignerPublicKeys(
  executor: DatabaseSession,
  bundle: PrincipalPolicyBundleResponse,
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

function externalAuthorityPrincipalId(
  bundle: PrincipalPolicyBundleResponse,
): string | null {
  const authorities = principalPolicyStates(bundle).flatMap((state) =>
    state.externalAuthority ? [state.externalAuthority] : [],
  );
  if (authorities.length === 0) {
    return null;
  }
  const [first] = authorities;
  if (
    !first ||
    first.principalType !== "group" ||
    authorities.some(
      (authority) =>
        authority.principalType !== "group" ||
        authority.principalId !== first.principalId,
    )
  ) {
    throw new PrincipalPolicyError(
      "Stored principal policy cites inconsistent external authority",
      409,
    );
  }
  return first.principalId;
}

export async function loadStoredPrincipalPolicyVerificationSource(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly executor: DatabaseSession;
}): Promise<StoredPrincipalPolicyVerificationSource> {
  const signerPublicKeys = await loadPolicySignerPublicKeys(
    input.executor,
    input.bundle,
  );
  const authorityPrincipalId = externalAuthorityPrincipalId(input.bundle);
  if (
    !authorityPrincipalId ||
    (input.bundle.currentState.principalType === "group" &&
      input.bundle.currentState.principalId === authorityPrincipalId)
  ) {
    return { authority: null, bundle: input.bundle, signerPublicKeys };
  }

  const authorityState = await getCurrentPrincipalState(
    "group",
    authorityPrincipalId,
    input.executor,
  );
  if (!authorityState) {
    throw new PrincipalPolicyError(
      "Stored principal policy external authority is missing",
      409,
    );
  }
  const authorityBundle = await buildPrincipalPolicyForStateWithExecutor(
    input.executor,
    authorityState,
  );
  return {
    authority: {
      bundle: authorityBundle,
      signerPublicKeys: await loadPolicySignerPublicKeys(
        input.executor,
        authorityBundle,
      ),
    },
    bundle: input.bundle,
    signerPublicKeys,
  };
}
