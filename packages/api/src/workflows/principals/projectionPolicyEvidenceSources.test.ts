import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  isAccessManifestBundleWireResponse,
  PrincipalPolicySnapshotPageResponseSchema,
  ProjectionPolicyEvidenceResponseSchema,
} from "@tearleads/validators/response";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { readProjectionAccessManifest } from "../../keyingProjectionRecords";
import * as snapshots from "./principalPolicySnapshots";
import { loadProjectionPolicyEvidence } from "./projectionPolicyEvidence";
import * as grants from "./projectionPolicyHistoryGrant";

async function fixture() {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  if (!isAccessManifestBundleWireResponse(root.bundle))
    throw new Error("Invalid fixture root bundle");
  const scope = {
    organizationId: await getDefaultOrganizationId(owner.userId),
    objectKind: "container" as const,
    objectId: root.kekState.containerId,
    userId: owner.userId,
  };
  return { owner, input: { executor: db, scope, bundles: [root.bundle] } };
}

test("projection sources issue scoped exact-head grants without full snapshots", async () => {
  const f = await fixture();
  const full = spyOn(
    snapshots,
    "loadVerifiedPrincipalPolicySnapshotsForReferences",
  );
  try {
    const evidence = await loadProjectionPolicyEvidence(f.input);
    expect(
      ProjectionPolicyEvidenceResponseSchema.safeParse(evidence).success,
    ).toBe(true);
    expect(evidence.organization).not.toBeNull();
    expect(evidence.groups.length).toBeGreaterThan(0);
    for (const source of [evidence.organization, ...evidence.groups]) {
      if (!source) throw new Error("Missing source");
      expect(
        grants.readProjectionPolicyHistoryGrant(source.grant, f.owner.userId),
      ).toEqual({
        ...f.input.scope,
        head: source.head,
      });
      const response = await requestPreparedPrincipalPolicy(
        `/principals/history?${new URLSearchParams({ grant: source.grant })}`,
        { headers: { Authorization: `Bearer ${f.owner.token}` } },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const page = PrincipalPolicySnapshotPageResponseSchema.parse(
        await response.json(),
      );
      expect(page.currentState.stateHash).toBe(source.head.stateHash);
      expect(source).not.toHaveProperty("previousStates");
      expect(source).not.toHaveProperty("currentPayload");
      expect(source).not.toHaveProperty("currentMemberEnvelopes");
    }
    for (const { reference, payload } of evidence.organizationPayloads) {
      expect(reference.principalId).toBe(f.input.scope.organizationId);
      expect(reference.stateHash).toBe(payload.stateHash);
      expect(reference.version).toBeGreaterThan(0);
    }
    expect(full).not.toHaveBeenCalled();
  } finally {
    full.mockRestore();
  }
}, 15_000);

test.each(["fingerprint", "version", "principal", "organization"] as const)(
  "projection source issuance rejects a substituted %s before issuing any grant",
  async (change) => {
    const f = await fixture();
    await loadProjectionPolicyEvidence(f.input);
    const original = f.input.bundles[0];
    if (!original) throw new Error("Missing fixture manifest");
    const manifest = readProjectionAccessManifest(
      original.manifest,
      "Fixture projection",
      (message) => new Error(message),
    );
    const first = manifest.referencedPrincipalHeads[0];
    if (!first) throw new Error("Missing fixture citation");
    const changed = {
      ...first,
      ...(change === "fingerprint" ? { keyFingerprint: "f".repeat(64) } : {}),
      ...(change === "version" ? { version: first.version + 1_000 } : {}),
      ...(change === "principal" ? { principalId: crypto.randomUUID() } : {}),
    };
    const bundles = [
      {
        ...original,
        manifest: {
          ...manifest,
          ...(change === "organization"
            ? { organizationId: crypto.randomUUID() }
            : {}),
          referencedPrincipalHeads: [
            changed,
            ...manifest.referencedPrincipalHeads.slice(1),
          ],
        },
      },
    ];
    const issue = spyOn(grants, "issueProjectionPolicyHistoryGrant");
    try {
      await expect(
        loadProjectionPolicyEvidence({ ...f.input, bundles }),
      ).rejects.toMatchObject({ status: 409 });
      expect(issue).not.toHaveBeenCalled();
    } finally {
      issue.mockRestore();
    }
  },
);
