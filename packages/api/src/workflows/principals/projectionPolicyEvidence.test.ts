import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isAccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import * as directories from "./projectionDirectoryBindings";
import { loadProjectionPolicyEvidence } from "./projectionPolicyEvidence";

test("projection evidence rejects foreign manifests and missing group bindings", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  if (!isAccessManifestBundleWireResponse(root.bundle))
    throw new Error("Invalid fixture bundle");
  const input = {
    executor: db,
    scope: {
      organizationId,
      objectKind: "container" as const,
      objectId: root.kekState.containerId,
      userId: owner.userId,
    },
    bundles: [root.bundle],
  };
  await expect(
    loadProjectionPolicyEvidence({
      ...input,
      scope: { ...input.scope, organizationId: crypto.randomUUID() },
    }),
  ).rejects.toMatchObject({
    status: 409,
    message: "Projection policy organization mismatch",
  });
  const original = directories.loadProjectionDirectoryBindings;
  const load = spyOn(
    directories,
    "loadProjectionDirectoryBindings",
  ).mockImplementation(async (request) => {
    const bindings = await original(request);
    bindings.bindingPayloadByGroupState.clear();
    return bindings;
  });
  try {
    await expect(loadProjectionPolicyEvidence(input)).rejects.toMatchObject({
      status: 409,
      message: "Projection group directory binding missing",
    });
  } finally {
    load.mockRestore();
  }
  expect(
    (await loadProjectionPolicyEvidence(input)).groups.length,
  ).toBeGreaterThan(0);
});
