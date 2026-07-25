import { expect, test } from "bun:test";
import { createDomainScope, type DomainScope } from "../data/domainScope";
import type { ContainerContentsRootAdoptionInput } from "../workflows/container-contents/runtime";
import { adoptSessionRootContainer } from "./rootContainerAdoption";

interface FixtureOptions {
  readonly actualDomainScope?: DomainScope | undefined;
  readonly containerId?: string | undefined;
  readonly defaultOrganizationId?: string | undefined;
  readonly isAuthenticated?: boolean | undefined;
  readonly organizationId?: string | undefined;
  readonly userId?: string | undefined;
}

function createFixture(options: FixtureOptions = {}) {
  const expectedDomainScope = createDomainScope();
  const setContainerIds: Array<string | null> = [];
  const session = {
    containerId: options.containerId ?? "stale-root",
    defaultOrganizationId: options.defaultOrganizationId ?? "organization-1",
    isAuthenticated: options.isAuthenticated ?? true,
    organizationId: options.organizationId ?? "organization-1",
    setContainerId(containerId: string | null) {
      setContainerIds.push(containerId);
      session.containerId = containerId ?? "";
    },
    userId: options.userId ?? "user-1",
  };
  const input: ContainerContentsRootAdoptionInput = {
    domainScope: expectedDomainScope,
    expectedContainerId: "stale-root",
    nextContainerId: "remote-root",
    organizationId: "organization-1",
    userId: "user-1",
  };

  return {
    dependencies: {
      getDomainScope: () => options.actualDomainScope ?? expectedDomainScope,
      session,
    },
    input,
    setContainerIds,
  };
}

test("root adoption replaces the expected stale session root", () => {
  const fixture = createFixture();

  expect(adoptSessionRootContainer(fixture.dependencies, fixture.input)).toBe(
    true,
  );
  expect(fixture.setContainerIds).toEqual(["remote-root"]);
});

test("root adoption accepts an already-adopted session without notifying again", () => {
  const fixture = createFixture({ containerId: "remote-root" });

  expect(adoptSessionRootContainer(fixture.dependencies, fixture.input)).toBe(
    "already-adopted",
  );
  expect(fixture.setContainerIds).toEqual([]);
});

test("root adoption accepts the active secondary organization", () => {
  const fixture = createFixture({
    defaultOrganizationId: "personal-organization",
  });

  expect(adoptSessionRootContainer(fixture.dependencies, fixture.input)).toBe(
    true,
  );
  expect(fixture.setContainerIds).toEqual(["remote-root"]);
});

const rejectedContexts: ReadonlyArray<
  readonly [name: string, options: FixtureOptions]
> = [
  ["domain scope", { actualDomainScope: createDomainScope() }],
  ["authentication", { isAuthenticated: false }],
  ["current root", { containerId: "other-root" }],
  ["organization", { organizationId: "organization-2" }],
  ["user", { userId: "user-2" }],
];

for (const [name, options] of rejectedContexts) {
  test(`root adoption rejects a mismatched ${name}`, () => {
    const fixture = createFixture(options);

    expect(adoptSessionRootContainer(fixture.dependencies, fixture.input)).toBe(
      false,
    );
    expect(fixture.setContainerIds).toEqual([]);
  });
}
