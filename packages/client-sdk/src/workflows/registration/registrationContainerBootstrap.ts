import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";

/**
 * Seed missing metadata inside the guarded bootstrap transaction. Discovered
 * rows retain their timestamps, access and topology; existing remote metadata
 * and its queue remain untouched. Return whether bootstrap metadata was written.
 */
export async function persistMissingContainerBootstrap(
  ...[execSql, container, record, options]: Parameters<
    typeof sqlContainerContentsPersistence.saveContainer
  >
): Promise<boolean> {
  let existing =
    await sqlContainerContentsPersistence.loadContainerMetadataState(
      execSql,
      container.id,
    );
  // A device-first root's local metadata is not discovered organization state.
  if (
    existing?.container.organizationId === "" &&
    existing.container.metadataDocumentId === null &&
    !existing.record?.accessStateHash
  )
    existing = null;
  if (existing?.record) return false;
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    existing?.container ?? container,
    record,
    existing
      ? {
          ...(existing.container.localUpdatedAt
            ? { localUpdatedAt: existing.container.localUpdatedAt }
            : {}),
        }
      : options,
  );
  return true;
}
