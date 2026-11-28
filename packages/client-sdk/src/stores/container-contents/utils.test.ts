import { expect, test } from "bun:test";
import { createContainerContentsTestRuntime } from "../../../test/helpers/workflows/containerContentsTestRuntime";
import { createDomainScope } from "../../data/shared/domainScope";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../workflows/container-contents/metadata/containerMetadataDocument";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "./state";
import type { ContainerState } from "./syncAgent";
import { toContainerNode } from "./utils";

async function createContainerState(
  input: Pick<ContainerState["container"], "icon" | "id">,
): Promise<ContainerState> {
  return {
    container: {
      icon: input.icon,
      id: input.id,
      effectiveAccessLevel: "admin",
      metadataDocumentId: "metadata-document",
      name: "Documents",
      organizationId: "org-1",
      parentId: null,
    },
    doc: await createContainerMetadataDocument(input.id),
    record: {
      accessEpoch: 1,
      accessStateHash: "access-state",
      contentKeyBundle: null,
      documentId: "metadata-document",
      documentKekTargets: null,
      documentManifestBundle: null,
      id: input.id,
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

test("toContainerNode exposes projected container metadata icons", async () => {
  expect(
    toContainerNode(
      await createContainerState({ icon: "folder", id: "with-icon" }),
    ),
  ).toMatchObject({
    icon: "folder",
    id: "with-icon",
  });

  expect(
    toContainerNode(
      await createContainerState({ icon: null, id: "without-icon" }),
    ),
  ).not.toHaveProperty("icon");
});

test("remote folder readiness follows content, not its fallback name", async () => {
  const state = await createContainerState({
    icon: null,
    id: "pending-folder",
  });
  expect(toContainerNode(state).metadataReady).toBe(false);
  writeContainerMetadataValue(state.doc, { name: "Untitled", icon: null });
  expect(toContainerNode(state).metadataReady).toBe(true);
});

test("updateContainerContentsSnapshot notifies listeners when only rootLaneMember changes", async () => {
  const storeState = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: createDomainScope(),
      execSql: async () => [],
    }),
    defaultContainerContentsPersistence,
  );
  const nested = await createContainerState({
    icon: null,
    id: "nested-folder",
  });
  nested.container = { ...nested.container, parentId: "parent-folder" };
  storeState.containersById.set(nested.container.id, nested);

  let emissions = 0;
  storeState.listeners.add(() => {
    emissions += 1;
  });

  updateContainerContentsSnapshot(storeState);
  expect(emissions).toBe(1);
  expect(storeState.snapshot.nodes[0]?.rootLaneMember).toBeUndefined();

  // Promote to root-lane member without changing any other node field.
  nested.container = { ...nested.container, rootLaneMember: true };
  updateContainerContentsSnapshot(storeState);
  expect(emissions).toBe(2);
  expect(storeState.snapshot.nodes[0]?.rootLaneMember).toBe(true);

  // Demote back without changing any other node field.
  nested.container = { ...nested.container, rootLaneMember: undefined };
  updateContainerContentsSnapshot(storeState);
  expect(emissions).toBe(3);
  expect(storeState.snapshot.nodes[0]?.rootLaneMember).toBeUndefined();
});
