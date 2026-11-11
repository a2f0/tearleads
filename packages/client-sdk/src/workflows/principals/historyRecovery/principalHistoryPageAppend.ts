import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyPageResponse } from "@tearleads/validators/response";
import { publishAcceptedPageIdentities } from "../../../data/principals/principalIdentityCommitments";
import { collectPrincipalPolicySignerPublicKeys } from "../policyVerification";
import type { PrincipalHistoryRecoveryStage } from "./principalHistoryRecoveryStage";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

/**
 * Verify one fetched page's entries onto the stage's chain. Members of an
 * accepted page are pinned at once: the next page's first signer is authorized
 * only by user ID against this page's last projection, so it must resolve to
 * the identity this page authenticated.
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
  const keys = await collectPrincipalPolicySignerPublicKeys({
    bundle: input.bundle,
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
    await publishAcceptedPageIdentities(
      entries,
      options.resolveTrustedUserIdentity,
    );
  return appended;
}
