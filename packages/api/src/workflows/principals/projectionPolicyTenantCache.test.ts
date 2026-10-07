import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import * as crypto from "@tearleads/crypto";
import { isAccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { loadProjectionPolicyEvidence } from "./projectionPolicyEvidence";

test("projection proofs reuse verified history across 24 organizations", async () => {
  const organizations: Parameters<typeof loadProjectionPolicyEvidence>[0][] =
    [];
  for (let index = 0; index < 24; index += 1) {
    const owner = createTestUser();
    await registerAndAuthenticate(owner);
    const root = await bootstrapRoot(owner);
    if (!isAccessManifestBundleWireResponse(root.bundle))
      throw new Error("Invalid fixture root bundle");
    organizations.push({
      executor: db,
      scope: {
        organizationId: await getDefaultOrganizationId(owner.userId),
        objectKind: "container",
        objectId: root.kekState.containerId,
        userId: owner.userId,
      },
      bundles: [root.bundle],
    });
  }
  const expected = [];
  for (const input of organizations) {
    expected.push(await loadProjectionPolicyEvidence(input));
  }
  const verify = spyOn(crypto, "verifyPrincipalPolicySnapshot");
  try {
    for (const [index, input] of organizations.entries()) {
      const previous = expected[index];
      if (!previous) throw new Error("Missing warm-up proof");
      expect(await loadProjectionPolicyEvidence(input)).toEqual(previous);
    }
    // Count expensive work rather than asserting wall-clock timing under CI load.
    expect({
      signatureVerifications: verify.mock.calls.length,
    }).toEqual({ signatureVerifications: 0 });
  } finally {
    verify.mockRestore();
  }
}, 60_000);
