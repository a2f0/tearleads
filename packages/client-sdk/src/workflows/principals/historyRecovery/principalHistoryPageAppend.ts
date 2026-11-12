import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyPageResponse } from "@tearleads/validators/response";
import {
  acceptedEntrySigners,
  collectPrincipalPolicySignerPublicKeys,
} from "../policyVerification";
import type { PrincipalHistoryRecoveryStage } from "./principalHistoryRecoveryStage";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

/**
 * Verify one fetched page's entries onto the stage's chain. The page's first
 * signer is authorized only by user ID against the last accepted state, so
 * it must resolve to the identity that state's signed projection committed.
 * Nothing is pinned here: a page is not yet proven to reach the expected
 * head, so its signers are only recorded, and published once it does.
 */
export async function appendVerifiedHistoryPage(input: {
  readonly options: RecoverPrincipalPolicyHistoryOptions;
  readonly stage: PrincipalHistoryRecoveryStage;
  readonly bundle: Parameters<
    typeof collectPrincipalPolicySignerPublicKeys
  >[0]["bundle"];
  readonly entries: PrincipalPolicyPageResponse["previousStates"];
}) {
  const { options, entries } = input;
  const predecessor = input.stage.verifier.getLatestAcceptedProjection();
  const keys = await collectPrincipalPolicySignerPublicKeys({
    bundle: input.bundle,
    predecessor,
    resolveTrustedUserIdentity: options.resolveTrustedUserIdentity,
  });
  if ("error" in keys)
    throw new KeyingVerificationError(
      keys.error === "not-found" ? "missing_dependency" : "signer_mismatch",
      "Principal history signer identity could not be authenticated",
    );
  const externalAuthority = await options.loadExternalAuthority?.(
    entries.flatMap(({ state }) =>
      state.externalAuthority ? [state.externalAuthority] : [],
    ),
  );
  const appended = await input.stage.verifier.append({
    entries,
    signerPublicKeys: keys.signerPublicKeys,
    ...(externalAuthority ? { externalAuthority } : {}),
  });
  if (appended.ok)
    input.stage.acceptedSigners.push(
      ...acceptedEntrySigners(entries, predecessor),
    );
  return appended;
}
