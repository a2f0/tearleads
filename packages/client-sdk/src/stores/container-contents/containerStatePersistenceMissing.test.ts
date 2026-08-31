import { expect, test } from "bun:test";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import { createDomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import { createDetachedContainerMetadataState } from "../../workflows/container-contents/metadataStateIsolation";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { persistContainerState } from "./containerStatePersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import { createContainerContentsStoreState } from "./state";

async function createState(id: string): Promise<ContainerState> {
  return {
    container: {
      effectiveAccessLevel: "admin",
      id,
      metadataDocumentId: `${id}-metadata`,
      name: id,
      organizationId: "org-1",
      parentId: "root",
      systemSlot: null,
    },
    doc: await createContainerMetadataDocument(id),
    record: {
      accessEpoch: 1,
      accessStateHash: `${id}-access`,
      documentId: `${id}-metadata`,
      id,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  } as ContainerState;
}

test.each([
  ["mapped state", false],
  ["replacement state", true],
] as const)("missing detached persistence preserves the %s reference guard", async (_name, installReplacement) => {
  const execSql = (async () => []) as ExecSql;
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    deletePendingUpdates: async () => {},
    loadContainerMetadataState: async () => null,
    saveContainer: async () => {
      throw new Error("a missing container must not be recreated");
    },
  };
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: createDomainScope(),
      execSql,
    }),
    persistence,
  );
  const liveState = await createState("child");
  const candidate = await createDetachedContainerMetadataState(liveState);
  const replacementState = await createState("child");
  state.containersById.set(
    liveState.container.id,
    installReplacement ? replacementState : liveState,
  );

  await expect(
    persistContainerState(state, candidate, {}, false, undefined, undefined, {
      expectedStateWhenMissing: liveState,
    }),
  ).resolves.toEqual({ status: "missing" });

  expect(state.containersById.get(liveState.container.id)).toBe(
    installReplacement ? replacementState : undefined,
  );
});
