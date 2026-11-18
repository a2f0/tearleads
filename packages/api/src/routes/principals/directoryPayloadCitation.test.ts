import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import { ContainerWriterProjectionWireResponseSchema } from "@tearleads/validators/response";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";

test("a projection read omits exactly the directory payloads whose states it cites", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const root = await bootstrapRoot(owner);
  const read = async (hint?: string) => {
    const response = await routeApp.request(
      `/containers/${root.kekState.containerId}/writer-projection`,
      {
        headers: {
          Authorization: `Bearer ${owner.token}`,
          ...(hint === undefined ? {} : { "x-known-manifests": hint }),
        },
      },
    );
    expect(response.status).toBe(200);
    return ContainerWriterProjectionWireResponseSchema.parse(
      await response.json(),
    );
  };
  const full = await read();
  const payloads = full.policyEvidence.organizationPayloads;
  const [directory] = payloads;
  if (!directory?.payload) throw new Error("Expected a directory payload");
  const cited = directory.reference.stateHash;
  // An unknown state hash changes nothing.
  const omitted = await read(`d:${cited},d:${"0".repeat(64)}`);
  expect(omitted.policyEvidence.organizationPayloads).toEqual(
    payloads.map((entry) =>
      entry.reference.stateHash === cited ? { ...entry, payload: null } : entry,
    ),
  );
  // The sources, heads and bundles still travel as for any reader.
  expect(omitted.policyEvidence.organization?.head).toEqual(
    full.policyEvidence.organization?.head,
  );
  expect(omitted.bundles).toEqual(full.bundles);
  expect(omitted.omittedBundles).toEqual([]);
  // A directory hint is not a manifest hint: the same hash under `m:`
  // omits no payload.
  expect(
    (await read(`m:${cited}`)).policyEvidence.organizationPayloads,
  ).toEqual(payloads);
  // More than eight directory hints is a malformed header.
  const refused = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "x-known-manifests": Array.from(
          { length: 9 },
          (_, index) => `d:${index.toString(16).padStart(64, "0")}`,
        ).join(","),
      },
    },
  );
  expect(refused.status).toBe(400);
});
