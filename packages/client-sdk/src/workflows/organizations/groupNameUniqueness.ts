import {
  KeyingVerificationError,
  type PrincipalPolicyExternalAuthority,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { throwKeyingVerificationErrorWithContext } from "../../data/keyingProjectionVerification/error";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../data/persistence/principalPolicyReferencePersistence";
import { retainVerifiedPrincipalPolicyBundle } from "../../data/persistence/verifiedPrincipalPolicyRetentionPersistence";
import {
  type OrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../../data/principals/organizationAuthorityDescriptor";
import {
  principalPolicyReferenceFromBundle,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../../data/principals/principalPolicyAdminSigners";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { collectPrincipalPolicySignerPublicKeys } from "../principals/policyVerification";
import { GroupMetadataUnreadableError } from "./groupMetadataAccess";
import { assertGroupMetadataBinding } from "./groupMetadataBinding";
import {
  canonicalGroupNameKey,
  type GroupPolicyNameReader,
  readGroupPolicyPayloadName,
} from "./principalPolicyRequest";

export interface DirectoryGroupWalkInput {
  readonly readEncryptedName?: GroupPolicyNameReader | undefined;
  readonly apiClient: {
    getCurrentPrincipalPolicy: (
      principalType: "group" | "organization",
      principalId: string,
    ) => Promise<PrincipalPolicyBundleResponse | null>;
  };
  readonly descriptor: OrganizationAuthorityDescriptor;
  readonly execSql: ExecSql;
  readonly externalAuthority: PrincipalPolicyExternalAuthority;
  readonly organizationId: string;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

type DirectoryGroupHead = OrganizationAuthorityDescriptor["groupHeads"][number];

interface VerifiedDirectoryGroup {
  readonly bundle: PrincipalPolicyBundleResponse;
  /** Null when the signed name does not decrypt for any member. */
  readonly name: string | null;
  readonly nameKey: string | null;
  readonly policy: VerifiedPrincipalPolicy;
}

/**
 * Loads one directory group at its committed head: from the local retained
 * bundles when they already hold that head, and from the API otherwise.
 */
async function loadDirectoryGroupBundle(
  input: DirectoryGroupWalkInput,
  head: DirectoryGroupHead,
) {
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    "group",
    head.principalId,
  );
  const cached = await loadPrincipalPolicyBundleForReference(
    input.execSql,
    head,
    localCheckpoint,
  );
  const bundle =
    cached ??
    (await input.apiClient.getCurrentPrincipalPolicy(
      "group",
      head.principalId,
    ));
  if (!bundle) {
    throw new Error(
      `Organization directory group ${head.principalId} could not be loaded`,
    );
  }
  if (
    !principalHeadMatchesReference(
      principalPolicyReferenceFromBundle(bundle),
      head,
    )
  ) {
    // Head drift is reachable by a concurrent admin mutation, so it is a
    // plain error to retry on, not an incident (as in the share path). The
    // typed errors stay for signature and projection failures.
    throw new Error(
      "Organization directory group policy does not match the signed organization directory",
    );
  }
  return { bundle, localCheckpoint };
}

/**
 * A bundle served from local retention was verified when it was retained, and
 * is verified again here on purpose: the re-check costs local CPU only, and it
 * keeps the name a group vouches for independent of what any earlier caller
 * trusted at retention time.
 */
export async function verifyDirectoryGroup(
  input: DirectoryGroupWalkInput,
  head: DirectoryGroupHead,
): Promise<VerifiedDirectoryGroup> {
  const { bundle, localCheckpoint } = await loadDirectoryGroupBundle(
    input,
    head,
  );
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in signerPublicKeys) {
    throw new Error(
      `Organization directory group signer key could not be loaded (${signerPublicKeys.error})`,
    );
  }
  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference: head,
      loadExternalAuthority: async () => input.externalAuthority,
      localCheckpoint,
      signerPublicKeys: signerPublicKeys.signerPublicKeys,
    });
  if (!verified.ok) {
    throwKeyingVerificationErrorWithContext(
      verified.error,
      "Organization directory group verification failed",
    );
  }
  assertGroupMetadataBinding(bundle, input.descriptor);
  const name = await readDirectoryGroupName(input, bundle);
  return {
    bundle,
    name,
    nameKey: name === null ? null : canonicalGroupNameKey(name),
    policy: verified.value,
  };
}

/**
 * A verified group whose name no member can open has no name to select by. The
 * walk isolates it rather than failing every name in the organization, but it
 * still records the incident: only a dishonest admin signs such a name.
 */
export async function readDirectoryGroupName(
  input: Pick<
    DirectoryGroupWalkInput,
    "readEncryptedName" | "reportSecurityIncident" | "organizationId"
  >,
  bundle: Parameters<typeof readGroupPolicyPayloadName>[0],
): Promise<string | null> {
  try {
    return await readGroupPolicyPayloadName(bundle, input.readEncryptedName);
  } catch (error) {
    if (!(error instanceof GroupMetadataUnreadableError)) throw error;
    await input.reportSecurityIncident(
      new KeyingVerificationError(
        "invalid_shape",
        "Signed group name does not open under the cited metadata key",
      ),
      {
        evidenceHashes: { stateHash: bundle.currentState.stateHash },
        objectId: bundle.currentState.principalId,
        objectKind: "principal",
        operation: "organization.groupName",
        organizationId: input.organizationId,
      },
    );
    return null;
  }
}

/**
 * Signed group names are the only authenticated label a member can choose a
 * group by, and the API does not make them unique within an organization. So
 * uniqueness is enforced here, where a name enters: before an admin signs a
 * new group, every group committed in the signed organization directory
 * (the reserved Admins and Members groups included) is loaded, verified
 * against its directory head, and its committed name compared by canonical
 * key. A share then needs only the target's verified name. A compromised
 * server cannot mint a signed group, so it cannot create the duplicate this
 * check refuses.
 *
 * The walk is fail-closed: one group that cannot be loaded or verified blocks
 * the creation, since an unverifiable group could carry any name. A verified
 * group whose name does not decrypt is skipped: no member can open that name,
 * so it cannot collide with one. It runs the
 * loads in parallel and retains every verified bundle, so a later creation
 * finds unchanged groups locally and fetches only those whose head moved.
 */
const DIRECTORY_WALK_CONCURRENCY = 4;

/** Runs `work` over `items` with at most `limit` in flight, keeping order. */
async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      results[index] = await work(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export async function assertGroupNameUniqueInDirectory(
  input: DirectoryGroupWalkInput & { readonly name: string },
): Promise<void> {
  const nameKey = canonicalGroupNameKey(input.name);
  // Each verified bundle is retained as soon as it verifies, so a failure
  // later in the walk (or a taken name) still leaves the cache warm for the
  // retry. Retention runs in a transaction on the shared connection, so the
  // writes are chained one after another while the loads stay concurrent.
  const retainedAt = new Date().toISOString();
  let retention: Promise<void> = Promise.resolve();
  const verifyAndRetain = async (
    head: DirectoryGroupHead,
  ): Promise<VerifiedDirectoryGroup> => {
    const group = await verifyDirectoryGroup(input, head);
    retention = retention.then(() =>
      retainVerifiedPrincipalPolicyBundle({
        bundle: group.bundle,
        execSql: input.execSql,
        organizationId: input.organizationId,
        policy: group.policy,
        updatedAt: retainedAt,
      }),
    );
    await retention;
    return group;
  };
  const groups = await mapWithConcurrency(
    input.descriptor.groupHeads,
    DIRECTORY_WALK_CONCURRENCY,
    verifyAndRetain,
  );
  // A taken name is user input to correct, not evidence of tampering, so this
  // is a plain error: group creation runs under security-incident reporting,
  // which records every KeyingVerificationError.
  if (groups.some((group) => group.nameKey === nameKey)) {
    throw new Error(
      "Another signed group in this organization already carries this name",
    );
  }
}
