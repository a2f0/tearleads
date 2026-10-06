import { expect, test } from "bun:test";
import { createContainerManifestFixture } from "@tearleads/crypto/test-fixtures";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { manifestBundle } from "../../../test/helpers/ancestorCitationScenario";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { projectionPolicyWarmer } from "../../../test/helpers/projectionPolicyHistory";
import {
  loadAccessManifestCheckpoint,
  loadPrincipalPolicyCheckpoint,
} from "../persistence/keyingCheckpointPersistence";
import {
  createProjectionCheckpointContext,
  finalizeProjectionCheckpoints,
  observeAccessManifestCheckpoints,
} from "./checkpointContext";
import { verifyContainerManifestPath } from "./containerPathVerification";
import { verifyProjectionAuthorizationEvidence } from "./projectionAuthorizationEvidence";
import { isProjectionVerificationCancelledError } from "./types";

async function fixture() {
  const data = await createOrganizationHistoryFixture();
  const database = createNativeTestExecSql();
  const context = createProjectionCheckpointContext({
    execSql: database.execSql,
    organizationId: data.organizationId,
  });
  const manifest = await createContainerManifestFixture({
    organizationId: data.organizationId,
    containerId: crypto.randomUUID(),
    directGrants: [
      {
        subjectType: "group",
        subjectId: data.created.currentState.principalId,
        accessLevel: "read",
      },
      {
        subjectType: "user",
        subjectId: data.signerUserId,
        accessLevel: "admin",
      },
    ],
    signer: data.signingKeyPair,
    signerUserId: data.signerUserId,
    referencedPrincipalHeads: [
      { ...principalPolicyHead(data.created), principalType: "group" },
    ],
  });
  const lease = { current: true };
  const warmer = projectionPolicyWarmer({
    execSql: database.execSql,
    bundles: data.projectionBundles,
    resolveUserKey: data.resolveTrustedUserIdentity,
  });
  const resolve = warmer.resolveProjectionHistory;
  if (!resolve) throw new Error("Missing fixture resolver");
  const authorizationEvidence = await verifyProjectionAuthorizationEvidence({
    bundles: [manifestBundle(manifest)],
    checkpointContext: context,
    organizationId: data.organizationId,
    policyEvidence: data.projectionEvidence(true),
    principalPolicyCache: new Map(),
    resolveUserKey: data.resolveTrustedUserIdentity,
    warmReferencedPrincipalPolicies: Object.assign(async () => {}, {
      resolveProjectionHistory: async (
        input: Parameters<typeof resolve>[0],
      ) => ({ ...(await resolve(input)), stillCurrent: () => lease.current }),
    }),
  });
  const verified = await verifyContainerManifestPath({
    authorizationEvidence,
    bundlesByHash: new Map([[manifest.manifestHash, manifestBundle(manifest)]]),
    checkpointContext: context,
    enforceLocalCheckpoints: true,
    label: "Admission fixture",
    path: [manifestBundle(manifest)],
    principalPolicyCache: new Map(),
    resolveUserKey: data.resolveTrustedUserIdentity,
    requireAuthorizationEvidence: true,
    servedAsCurrent: true,
    verifiedByHash: new Map(),
  });
  observeAccessManifestCheckpoints(context, {
    verifiedHeads: verified,
    verifiedManifests: verified,
  });
  const accessPin = () =>
    loadAccessManifestCheckpoint(
      database.execSql,
      "container",
      data.organizationId,
      manifest.state.containerId,
    );
  const policyPin = () =>
    loadPrincipalPolicyCheckpoint(
      database.execSql,
      "group",
      data.created.currentState.principalId,
    );
  return { ...database, data, context, lease, accessPin, policyPin };
}

for (const persistVerificationCheckpoints of [false, true]) {
  test(`public authorization rechecks a conflicting local pin during ${persistVerificationCheckpoints ? "admission" : "validation"}`, async () => {
    const f = await fixture();
    try {
      await f.execSql(
        `INSERT INTO principal_policy_checkpoints (principal_type, principal_id, version, state_hash, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [
          "group",
          f.data.created.currentState.principalId,
          1,
          "f".repeat(64),
          "2026-10-06T00:00:00.000Z",
        ],
      );
      await expect(
        finalizeProjectionCheckpoints(f.context, {
          persistVerificationCheckpoints,
        }),
      ).rejects.toMatchObject({ code: "stale_predecessor" });
      expect(await f.accessPin()).toBeNull();
      expect(await f.policyPin()).toMatchObject({
        version: 1,
        stateHash: "f".repeat(64),
      });
    } finally {
      f.close();
    }
  });
  test(`public authorization cancels an expired private lease during ${persistVerificationCheckpoints ? "admission" : "validation"}`, async () => {
    const f = await fixture();
    try {
      f.lease.current = false;
      const error = await finalizeProjectionCheckpoints(f.context, {
        persistVerificationCheckpoints,
      }).catch((error: unknown) => error);
      expect(isProjectionVerificationCancelledError(error)).toBe(true);
      expect(await f.accessPin()).toBeNull();
      expect(await f.policyPin()).toBeNull();
    } finally {
      f.close();
    }
  });
}

test("a newer pin acquired after recovery is unavailable and leaves the complete batch unchanged", async () => {
  const f = await fixture();
  try {
    await f.execSql(
      `INSERT INTO principal_policy_checkpoints (principal_type, principal_id, version, state_hash, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [
        "group",
        f.data.created.currentState.principalId,
        3,
        "f".repeat(64),
        "2026-10-06T00:00:00.000Z",
      ],
    );
    await expect(
      finalizeProjectionCheckpoints(f.context, {}),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(await f.accessPin()).toBeNull();
    expect(await f.policyPin()).toMatchObject({ version: 3 });
  } finally {
    f.close();
  }
});

test("admitting a verified manifest never promotes historical authorization to a current-policy pin", async () => {
  const f = await fixture();
  try {
    await finalizeProjectionCheckpoints(f.context, {});
    expect(await f.accessPin()).not.toBeNull();
    expect(await f.policyPin()).toBeNull();
    expect(f.context.policies).toEqual([]);
  } finally {
    f.close();
  }
});
