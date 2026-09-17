import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import { createContainerContentsStoreState } from "./state";
import {
  findRootContainerState,
  findSystemContainerStateForRoot,
} from "./systemContainerLookup";

const slot = `sys_v1_${"a".repeat(43)}`;
for (const [organizationId, parentId, accepted] of [
  ["foreign-org", "foreign-root", false],
  ["org-1", "wrong-root", false],
  ["org-1", "acknowledged-root", true],
] as const) {
  test(`a missing root row cannot redirect the system slot to ${organizationId}/${parentId}`, () => {
    const runtime = createContainerContentsTestRuntime({
      domainScope: createDomainScope(),
      execSql: async () => [],
      rootContainerId: "acknowledged-root",
      organizationId: "org-1",
    });
    const state = createContainerContentsStoreState(
      runtime,
      defaultContainerContentsPersistence,
    );
    const candidate = createTestContainerState({
      id: "system",
      organizationId,
      parentId,
    });
    candidate.container.systemSlot = slot;
    state.containersById.set("system", candidate);
    expect(findSystemContainerStateForRoot(state, slot, null)).toBe(
      accepted ? candidate : null,
    );
  });
}

test("an explicit foreign root keeps its own system-write invalidation scope", () => {
  const runtime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    execSql: async () => [],
    rootContainerId: "personal-root",
    organizationId: "personal-org",
  });
  const state = createContainerContentsStoreState(
    runtime,
    defaultContainerContentsPersistence,
  );
  const root = createTestContainerState({
    id: "foreign-root",
    organizationId: "foreign-org",
    parentId: null,
  });
  const system = createTestContainerState({
    id: "foreign-system",
    organizationId: "foreign-org",
    parentId: root.container.id,
  });
  system.container.systemSlot = slot;
  state.containersById.set(system.container.id, system);
  expect(findSystemContainerStateForRoot(state, slot, root)).toBe(system);
});

test("root selection excludes organization metadata even when it is the only root", () => {
  const runtime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    execSql: async () => [],
    organizationId: "org-1",
    rootContainerId: null,
  });
  const state = createContainerContentsStoreState(
    runtime,
    defaultContainerContentsPersistence,
  );
  const metadata = createTestContainerState({
    id: "metadata-root",
    organizationId: "org-1",
    parentId: null,
  });
  metadata.container.systemSlot = slot;
  state.containersById.set(metadata.container.id, metadata);
  expect(findRootContainerState(state)).toBeNull();
  const personal = createTestContainerState({
    id: "personal-root",
    organizationId: "org-1",
    parentId: null,
  });
  state.containersById.set(personal.container.id, personal);
  expect(findRootContainerState(state)).toBe(personal);
});
