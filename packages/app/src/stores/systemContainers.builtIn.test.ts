import { expect, test } from "bun:test";
import {
  ORGANIZATION_METADATA_CONTAINER_NAME,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
} from "@tearleads/client-sdk";
import { deriveBuiltInSystemContainers } from "./systemContainers";

const ORGANIZATION_ID = "org-1";

test("the built-in system containers are the org roster and metadata folders", async () => {
  const builtInSystemContainers = await deriveBuiltInSystemContainers({
    organizationId: ORGANIZATION_ID,
  });

  expect(
    builtInSystemContainers.map((builtInSystemContainer) => ({
      kind: builtInSystemContainer.kind,
      name: builtInSystemContainer.name,
    })),
  ).toEqual([
    {
      kind: "organizationRosterProfiles",
      name: ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
    },
    {
      kind: "organizationMetadata",
      name: ORGANIZATION_METADATA_CONTAINER_NAME,
    },
  ]);
});

test("built-in system containers reject inbound links", async () => {
  // The rules the feature flag's containers carry: revealing them in the tree
  // must not make them "Link Document" destinations.
  const builtInSystemContainers = await deriveBuiltInSystemContainers({
    organizationId: ORGANIZATION_ID,
  });

  for (const builtInSystemContainer of builtInSystemContainers) {
    expect(builtInSystemContainer.rules.protectFromInboundLinks).toBe(true);
  }
});

test("built-in system slots are distinct per container and per organization", async () => {
  // The slots are derived from the organization id rather than a per-user key,
  // so every member resolves the same slot — which is what lets the rules be
  // keyed by slot instead of by container name.
  const [roster, metadata] = await deriveBuiltInSystemContainers({
    organizationId: ORGANIZATION_ID,
  });
  const [otherOrgRoster] = await deriveBuiltInSystemContainers({
    organizationId: "org-2",
  });
  const [sameOrgRosterAgain] = await deriveBuiltInSystemContainers({
    organizationId: ORGANIZATION_ID,
  });

  expect(roster?.systemSlot).not.toBe(metadata?.systemSlot ?? "");
  expect(roster?.systemSlot).not.toBe(otherOrgRoster?.systemSlot ?? "");
  expect(roster?.systemSlot).toBe(sameOrgRosterAgain?.systemSlot ?? "");
});
