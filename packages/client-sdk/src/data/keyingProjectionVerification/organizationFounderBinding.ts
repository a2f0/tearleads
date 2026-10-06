import type { PrincipalPolicyAuthorization } from "@tearleads/crypto";
import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { rememberOrganizationFounder } from "../persistence/organizationFounderPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { verifiedContainerCreateManifest } from "./containerCreateManifest";

/**
 * A directory can cite someone else's public policies. Bind its founder to the
 * verified personal root's creator before trusting it to authorize a rehome.
 * Metadata roots can be created by later admins and cannot establish this pin.
 * This immutable identity anchor survives read-only verification and canceled
 * views; it neither advances nor replaces a current-policy checkpoint.
 */
export async function rememberRootBoundOrganizationFounder(input: {
  readonly execSql: ExecSql;
  readonly policies: readonly PrincipalPolicyAuthorization[] | undefined;
  readonly root: VerifiedContainerAccessManifest | undefined;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): Promise<void> {
  const { root } = input;
  if (!root || root.state.systemSlot !== null) return;
  const organization = input.policies?.find(
    (policy) =>
      policy.principalType === "organization" &&
      policy.principalId === root.state.organizationId,
  );
  if (!organization) return;
  const entries =
    "retainedHistory" in organization
      ? organization.retainedHistory
      : organization.history;
  if (!entries) return;
  const genesis = entries.find(({ state }) => state.version === 1)?.state;
  if (!genesis)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Organization founder requires verified genesis",
    );
  const created = verifiedContainerCreateManifest({
    head: root,
    label: "Organization founder root",
    verifiedByHash: input.verifiedByHash,
  });
  if (
    genesis?.signerUserId !== created.event.event.signerUserId ||
    genesis.signerUserKeyFingerprint !==
      created.event.event.signerKeyFingerprint
  )
    throw new KeyingVerificationError(
      "signer_mismatch",
      "Organization founder does not match its verified personal root's creator",
    );
  await rememberOrganizationFounder({
    execSql: input.execSql,
    organization,
  });
}
