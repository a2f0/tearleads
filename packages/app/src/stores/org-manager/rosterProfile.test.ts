import { expect, mock, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  ensureOrganizationSystemContainer,
  findOrganizationSystemContainer,
} from "./rosterProfile";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const SLOT = "roster-profile-slot" as ContainerSystemSlot;
const created = { id: "created" } as ContainerNode;

function store(nodes: ReadonlyArray<Partial<ContainerNode>>) {
  return {
    ensureSystemContainer: mock(() => Promise.resolve(created)),
    getSnapshot: () => ({ nodes }),
  };
}

const node = (input: Partial<ContainerNode>) => ({
  organizationId: ORGANIZATION_ID,
  parentId: "org-root",
  systemSlot: SLOT,
  ...input,
});

test("finding an absent system container returns null and never provisions it", () => {
  const containers = store([
    node({ id: "other", systemSlot: "other-slot" as ContainerSystemSlot }),
  ]);
  expect(
    findOrganizationSystemContainer({
      containerStore: containers as never,
      independentRoot: false,
      organizationId: ORGANIZATION_ID,
      systemSlot: SLOT,
    }),
  ).toBeNull();
  expect(containers.ensureSystemContainer).toHaveBeenCalledTimes(0);
});

test("finding respects whether the container is an organization root", () => {
  const child = node({ id: "child" });
  const root = node({ id: "root", parentId: null });
  const containers = store([child, root]);
  const find = (independentRoot: boolean) =>
    findOrganizationSystemContainer({
      containerStore: containers as never,
      independentRoot,
      organizationId: ORGANIZATION_ID,
      systemSlot: SLOT,
    });
  expect(find(false)).toBe(child as never);
  expect(find(true)).toBe(root as never);
});

test("ensuring provisions only when the device lists no such container", async () => {
  const existing = node({ id: "existing" });
  const listed = store([existing]);
  const ensure = (containers: ReturnType<typeof store>) =>
    ensureOrganizationSystemContainer({
      containerStore: containers as never,
      independentRoot: false,
      name: "Roster Profiles",
      organizationId: ORGANIZATION_ID,
      systemSlot: SLOT,
    });
  expect(await ensure(listed)).toBe(existing as never);
  expect(listed.ensureSystemContainer).toHaveBeenCalledTimes(0);

  const empty = store([]);
  expect(await ensure(empty)).toBe(created);
  expect(empty.ensureSystemContainer).toHaveBeenCalledWith(
    SLOT,
    "Roster Profiles",
  );
});
