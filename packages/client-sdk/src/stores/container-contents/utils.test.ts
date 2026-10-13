import { expect, test } from "bun:test";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
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
