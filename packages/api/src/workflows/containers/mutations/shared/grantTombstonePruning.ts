import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  ContainerDirectGrant,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import {
  expandContainerSubtreeIds,
  pruneRegainedAccessTombstones,
} from "../../../regainedAccessTombstones";
import { userIdsForGrant } from "../../containerPathUsers";

export function directGrantKey(
  grant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): string {
  return `${grant.subjectType}:${grant.subjectId}`;
}

function addedDirectGrants(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly previousManifest: VerifiedContainerAccessManifest;
}): ContainerDirectGrant[] {
  const previousGrantKeys = new Set(
    input.previousManifest.state.directGrants.map(directGrantKey),
  );

  return input.manifest.state.directGrants.filter(
    (grant) => !previousGrantKeys.has(directGrantKey(grant)),
  );
}

async function addedGrantUserIds(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly previousManifest: VerifiedContainerAccessManifest;
}): Promise<string[]> {
  const userIds = new Set<string>();

  for (const grant of addedDirectGrants(input)) {
    for (const userId of await userIdsForGrant({
      executor: input.executor,
      grant,
      manifest: input.manifest,
    })) {
      userIds.add(userId);
    }
  }

  return Array.from(userIds);
}

/**
 * The mirror of persistAccessRevocationTombstones: a grant that gives users
 * (back) readable access must prune their stale access_revoked tombstones,
 * or the lane page keeps serving the old tombstone alongside the restored
 * item and the client's last-writer filter suppresses the container forever
 * (a grant advances no container timestamp).
 */
export async function pruneAccessGrantTombstones(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
}): Promise<void> {
  const { executor, manifest, previousManifest } = input;
  if (
    manifest.event.event.eventType !== "container.grant" ||
    previousManifest === null
  ) {
    return;
  }

  const gainedUserIds = await addedGrantUserIds({
    executor,
    manifest,
    previousManifest,
  });
  if (gainedUserIds.length === 0) {
    return;
  }

  // Access gained through this grant reaches the granted container and its
  // local descendants; scope the prune to that subtree.
  await pruneRegainedAccessTombstones({
    containerIds: await expandContainerSubtreeIds(executor, [
      manifest.state.containerId,
    ]),
    executor,
    organizationId: manifest.state.organizationId,
    userIds: gainedUserIds,
  });
}
