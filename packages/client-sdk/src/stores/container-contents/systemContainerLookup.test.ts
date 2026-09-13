import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import { createContainerContentsStoreState } from "./state";
import { findSystemContainerStateForRoot } from "./systemContainerLookup";

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
