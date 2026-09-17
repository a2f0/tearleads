import { expect, test } from "bun:test";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { createDomainScope } from "../../data/domainScope";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { ensureSystemContainer } from "./operations";
import {
  invalidateRemoteContainerWrites,
  trackRemoteContainerWrite,
} from "./remoteWriteGuards";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

async function createFixture(online = true) {
  const systemSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: "org-1",
  });
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: createDomainScope(),
      execSql: async () => [],
      organizationId: "org-1",
      containerId: "personal-root",
      online,
    }),
    {
      ...defaultContainerContentsPersistence,
      saveContainer: async () => {
        throw new Error("metadata ensure must never create a child");
      },
    },
  );
  const root = createTestContainerState({
    id: "personal-root",
    organizationId: "org-1",
    parentId: null,
  });
  const metadata = createTestContainerState({
    id: "provisioned-metadata",
    organizationId: "org-1",
    parentId: null,
  });
  metadata.container.systemSlot = systemSlot;
  state.containersById.set(root.container.id, root);
  updateContainerContentsSnapshot(state);
  const probes: unknown[] = [];
  const agent = (hydrate: () => void = () => {}) =>
    ({
      requestRemoteHydration: async (options: unknown) => {
        probes.push(options);
        hydrate();
      },
    }) as ContainerContentsStoreSyncAgent;
  return { state, root, metadata, systemSlot, probes, agent };
}

test("profile ensure discovers the provisioned metadata root before hydration", async () => {
  const fixture = await createFixture();
  const { state, metadata, systemSlot } = fixture;
  const foreign = createTestContainerState({
    id: "foreign",
    organizationId: "org-2",
    parentId: null,
  });
  const child = createTestContainerState({
    id: "invalid-child",
    organizationId: "org-1",
    parentId: "personal-root",
  });
  for (const decoy of [foreign, child]) {
    decoy.container.systemSlot = systemSlot;
    state.containersById.set(decoy.container.id, decoy);
  }
  const syncAgent = fixture.agent(() =>
    state.containersById.set(metadata.container.id, metadata),
  );
  const node = await ensureSystemContainer(
    state,
    syncAgent,
    systemSlot,
    "Organization metadata",
  );
  expect(node).toMatchObject({
    id: metadata.container.id,
    parentId: null,
    organizationId: "org-1",
  });
  expect(fixture.probes).toEqual([
    { parentIds: [null], followDiscoveredParentLanes: false },
  ]);
  expect(
    await ensureSystemContainer(
      state,
      syncAgent,
      systemSlot,
      "Organization metadata",
    ),
  ).toEqual(node);
  expect(fixture.probes).toHaveLength(1);
});

test.each(["missing", "offline", "deferred", "network-failure"] as const)(
  "metadata ensure never creates a child when discovery is %s",
  async (mode) => {
    const fixture = await createFixture(mode !== "offline");
    const node = await ensureSystemContainer(
      fixture.state,
      fixture.agent(() => {
        if (mode === "network-failure") throw new Error("offline");
      }),
      fixture.systemSlot,
      "Organization metadata",
      { deferRemoteBootstrap: mode === "deferred" },
    );
    expect(node).toBeNull();
    expect(fixture.state.containersById.size).toBe(1);
    expect(fixture.probes).toHaveLength(
      mode === "offline" || mode === "deferred" ? 0 : 1,
    );
  },
);

test("metadata ensure stops when its generation changes during slot derivation", async () => {
  const fixture = await createFixture();
  let current = true;
  const pending = ensureSystemContainer(
    fixture.state,
    fixture.agent(),
    fixture.systemSlot,
    "Organization metadata",
    {},
    () => current,
  );
  current = false;
  expect(await pending).toBeNull();
  expect(fixture.probes).toHaveLength(0);
});

test("a local metadata edit invalidates pre-auth-root ensure during discovery", async () => {
  const { state, root, metadata, systemSlot, agent } = await createFixture();
  root.container.organizationId = "";
  root.container.metadataDocumentId = "";
  const write = trackRemoteContainerWrite(state, {
    rootId: root.container.id,
    systemSlot,
  });
  try {
    const ensured = await ensureSystemContainer(
      state,
      agent(() => {
        state.containersById.set(metadata.container.id, metadata);
        invalidateRemoteContainerWrites(state, [metadata.container.id]);
      }),
      systemSlot,
      "Organization metadata",
      {},
      () => !write.changed(),
    );
    expect(write.changed()).toBe(true);
    expect(ensured).toBeNull();
  } finally {
    write.dispose();
  }
});
