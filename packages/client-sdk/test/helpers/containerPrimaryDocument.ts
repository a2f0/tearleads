import { bytesToBase64 } from "@tearleads/encoding";
import { emptyVersionVector, exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../src/data/persistence/documents/documentsPersistence";
import type { DomainScope } from "../../src/data/shared/domainScope";
import { createContainerWriteMethods } from "../../src/stores/container-contents/containerContentsStore";
import { createContainerContentsTestRuntime } from "../../src/stores/container-contents/runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "../../src/stores/container-contents/state";
import type { ContainerContentsStoreSyncAgent } from "../../src/stores/container-contents/syncAgent";
import { defaultContainerContentsPersistence } from "../../src/workflows/container-contents/containerPersistence";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../src/workflows/container-contents/metadata/containerMetadataDocument";
import {
  createContainerRecord,
  createDocumentRecord,
} from "../../src/workflows/container-contents/metadata/metadata.testFixtures";

export async function primaryDocumentFixture() {
  const db = await createTestExecSql("container-primary-write");
  const persistence = defaultContainerContentsPersistence;
  await persistence.ensureSchema(db.execSql);
  await sqlDocumentsPersistence.ensureSchema(db.execSql);
  const container = createContainerRecord({
    id: "folder",
    parentId: null,
    name: "Person",
    icon: "user",
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, {
    name: container.name,
    icon: container.icon,
  });
  const record = createDocumentRecord({
    id: container.id,
    metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
  });
  await persistence.saveContainer(db.execSql, container, record);
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: {} as DomainScope,
      execSql: db.execSql,
      online: false,
    }),
    persistence,
  );
  const live = { container, doc, record };
  state.containersById.set(container.id, live);
  updateContainerContentsSnapshot(state);
  const syncAgent = { scheduleSync() {} } as ContainerContentsStoreSyncAgent;
  const methods = createContainerWriteMethods(state, syncAgent);
  const seed = async (documentId: string, containerId = container.id) => {
    await sqlDocumentsPersistence.saveDocument(db.execSql, {
      id: `local-${documentId}`,
      documentId,
      containerId,
      documentKind: "contact",
      title: documentId,
      text: "",
      accessEpoch: 1,
      snapshotEndVersion: emptyVersionVector(),
      effectiveAccessLevel: "read",
    });
  };
  return { ...db, live, methods, persistence, seed, state };
}
