import { hasUnsettledDocumentPlacement } from "../../../data/persistence/container-contents/documentPurgePlacement";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { ContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";

interface LocalPurgeScopeInput {
  containerId: string | null | undefined;
  containersById: ReadonlyMap<string, ContainerState>;
  execSql: ExecSql;
  localId?: string | undefined;
  persistence: ContainerContentsPersistence;
  rootContainerId: string;
  stillCurrent?: (() => boolean) | undefined;
  verifiedAncestorsById: ReadonlyMap<string, readonly string[]>;
}

function guardedContainerIds(input: LocalPurgeScopeInput): ReadonlySet<string> {
  const guardedIds = new Set<string>();
  const seen = new Set<string>();
  let currentId = input.containerId;
  while (true) {
    if (!currentId || seen.has(currentId)) throw changedScope();
    seen.add(currentId);
    guardedIds.add(currentId);
    for (const id of input.verifiedAncestorsById.get(currentId) ?? [])
      guardedIds.add(id);
    const expected = input.containersById.get(currentId);
    if (!expected) throw changedScope();
    if (currentId === input.rootContainerId) break;
    currentId = expected.container.parentId;
  }
  return guardedIds;
}

/** Called inside the document deletion transaction; performs no remote I/O. */
export async function assertLocalPurgeScope(
  input: LocalPurgeScopeInput,
): Promise<void> {
  if (
    input.localId !== undefined &&
    (await hasUnsettledDocumentPlacement(input.execSql, input.localId))
  )
    throw changedScope();
  const guardedIds = guardedContainerIds(input);
  // Include every known signed ancestor as well as the local selection chain.
  // A dishonest listing can give these chains different intermediate nodes.
  for (const id of guardedIds) {
    const expected = input.containersById.get(id);
    if (!expected) continue;
    const current = await input.persistence.loadContainerMetadataState(
      input.execSql,
      id,
    );
    if (
      !current?.record ||
      current.container.parentId !== expected.container.parentId ||
      current.container.organizationId !== expected.container.organizationId ||
      current.record.documentId !== expected.record.documentId
    )
      throw changedScope();
  }
  const pending = await input.persistence.listUnsyncedMoveIntents(
    input.execSql,
  );
  if (
    pending.some((intent) => guardedIds.has(intent.containerId)) ||
    input.stillCurrent?.() === false
  )
    throw changedScope();
}

function changedScope(): Error {
  return new Error(
    "Local subtree purge scope changed before deletion committed",
  );
}
