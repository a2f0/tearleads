import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { exportAllUpdates, importUpdates } from "@symcrypt/loro";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  type ContainerMetadataRecord,
  enqueuePendingContainerUpdate,
  type StoredContainerState,
} from "./containerPersistence";
import type { ContainerState } from "./remoteHydration/types";

type SaveContainerOptions = Parameters<
  ContainerContentsPersistence["saveContainer"]
>[3];

function createInitialContainerRecord(input: {
  container: StoredContainerState["container"];
  metadataUpdates: string;
}): ContainerMetadataRecord {
  return {
    accessEpoch: 1,
    accessStateHash: null,
    contentKeyBundle: null,
    documentId: input.container.metadataDocumentId,
    documentKekTargets: null,
    documentManifestBundle: null,
    id: input.container.id,
    lastCommitLsn: null,
    metadataUpdates: input.metadataUpdates,
    snapshotEndVersion: "",
  };
}

function metadataProjectionChanged(
  left: StoredContainerState["container"],
  right: StoredContainerState["container"],
): boolean {
  return left.icon !== right.icon || left.name !== right.name;
}

function replaySaveOptions(
  container: StoredContainerState["container"],
): SaveContainerOptions {
  const localUpdatedAt =
    container.localUpdatedAt ?? container.updatedAt ?? null;
  return localUpdatedAt ? { localUpdatedAt } : undefined;
}

export async function hydrateStoredContainerState(input: {
  execSql: ExecSql;
  persistence: ContainerContentsPersistence;
  storedContainer: StoredContainerState;
}): Promise<ContainerState> {
  const { execSql, persistence, storedContainer } = input;
  const { container } = storedContainer;
  const doc = await createContainerMetadataDocument(container.id);
  let nextContainer = container;
  let nextRecord = storedContainer.record;

  if (nextRecord?.metadataUpdates) {
    importUpdates(doc, [base64ToBytes(nextRecord.metadataUpdates)]);
    const metadata = readContainerMetadataValue(
      doc,
      getDefaultContainerName(container.parentId),
    );
    nextContainer = {
      ...container,
      icon: metadata.icon,
      name: metadata.name,
    };
    if (metadataProjectionChanged(container, nextContainer)) {
      await persistence.saveContainer(
        execSql,
        nextContainer,
        nextRecord,
        replaySaveOptions(container),
      );
    }
  } else {
    writeContainerMetadataValue(doc, {
      icon: container.icon,
      name: container.name,
    });
    const initialUpdate = exportAllUpdates(doc);
    nextRecord = createInitialContainerRecord({
      container,
      metadataUpdates: bytesToBase64(initialUpdate),
    });
    await persistence.saveContainer(execSql, nextContainer, nextRecord);

    if (!container.metadataDocumentId) {
      await enqueuePendingContainerUpdate(execSql, persistence, {
        containerId: container.id,
        update: initialUpdate,
      });
    }
  }

  return { container: nextContainer, doc, record: nextRecord };
}

/** Materialize a CAS winner without writing repair rows from a stale caller. */
export async function materializeStoredContainerStateReadOnly(input: {
  storedContainer: StoredContainerState;
}): Promise<ContainerState | null> {
  const { container, record } = input.storedContainer;
  if (!record) return null;
  const doc = await createContainerMetadataDocument(container.id);
  let nextContainer = container;
  if (record.metadataUpdates) {
    importUpdates(doc, [base64ToBytes(record.metadataUpdates)]);
    const metadata = readContainerMetadataValue(
      doc,
      getDefaultContainerName(container.parentId),
    );
    nextContainer = { ...container, icon: metadata.icon, name: metadata.name };
  } else {
    writeContainerMetadataValue(doc, {
      icon: container.icon,
      name: container.name,
    });
  }
  return { container: nextContainer, doc, record };
}
