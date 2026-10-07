import { expect, test } from "bun:test";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import {
  containerWrappingPublicKeyForTest,
  createContainerManifestFixture,
  fixtureHash,
} from "@tearleads/crypto/test-fixtures";
import {
  createNativeTestExecSql,
  createNoBrickTraceRecorder,
  persistNoBrickTrace,
} from "@tearleads/test-utils";
import {
  manifestBundle,
  successor,
} from "../../../test/helpers/ancestorCitationScenario";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { projectionPolicyWarmer } from "../../../test/helpers/projectionPolicyHistory";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { verifyContainerManifestPath } from "./containerPathVerification";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";

test("fresh devices receive verifiable authority after its citation becomes historical and the group is deleted", async () => {
  const data = await createOrganizationHistoryFixture();
  const containerId = crypto.randomUUID();
  const root = await createContainerManifestFixture({
    organizationId: data.organizationId,
    containerId,
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
    referencedPrincipalHeads: [
      { ...principalPolicyHead(data.created), principalType: "group" },
    ],
    signer: data.signingKeyPair,
    signerUserId: data.signerUserId,
  });
  const revoked = await successor({
    previous: root,
    cited: [root.manifestHash],
    signer: { keyPair: data.signingKeyPair, userId: data.signerUserId },
    body: {
      eventType: "container.revoke",
      parentManifestHash: null,
      containerKeyEpochId: "revoked-key-epoch",
      containerKeyPublicKey:
        containerWrappingPublicKeyForTest("revoked-key-epoch"),
      keyringHash: await fixtureHash("revoked-keyring"),
      predecessorBridgeHash: await fixtureHash("revoked-bridge"),
      subjectId: data.created.currentState.principalId,
      subjectType: "group",
    },
    state: (previous) => ({
      containerKeyEpochId: "revoked-key-epoch",
      directGrants: previous.directGrants.filter(
        (grant) => grant.subjectType !== "group",
      ),
      referencedPrincipalHeads: [],
    }),
  });
  expect(
    revoked.state.directGrants.every((grant) => grant.subjectType === "user"),
  ).toBe(true);
  expect(revoked.state.referencedPrincipalHeads).toEqual([]);
  const bundles = [root, revoked].map(manifestBundle);
  const recorder = createNoBrickTraceRecorder("historical-policy-delivery", {
    d1: 0,
    d2: 0,
  });
  recorder.record({ action: "AdvanceAuthority" });
  recorder.record({ action: "DropAuthorityReference" });
  for (const deleted of [false, true]) {
    if (deleted) recorder.record({ action: "DeleteAuthority" });
    const database = createNativeTestExecSql();
    const history = data.projectionEvidence(deleted);
    try {
      const { policies } = await verifyProjectionPolicyEvidence({
        organizationId: data.organizationId,
        references: [principalPolicyHead(data.created)],
        warmReferencedPrincipalPolicies: projectionPolicyWarmer({
          execSql: database.execSql,
          bundles: data.projectionBundles,
          resolveUserKey: data.resolveTrustedUserIdentity,
        }),
        evidence: history,
      });
      // The dependent's frozen citation still names version 1. The group has
      // advanced to version 2; its old membership comes only from signed history.
      expect(
        policies.some((policy) =>
          principalPolicyMatchesReference({
            policy,
            reference: principalPolicyHead(data.created),
          }),
        ),
      ).toBe(true);
      const verifiedByHash = new Map();
      const verified = await verifyContainerManifestPath({
        authorizationEvidence: policies,
        authorizationMembership: "referenced",
        bundlesByHash: new Map(
          bundles.map((bundle) => [bundle.manifestHash, bundle]),
        ),
        checkpointContext: createProjectionCheckpointContext({
          execSql: database.execSql,
          organizationId: data.organizationId,
        }),
        enforceLocalCheckpoints: true,
        servedAsCurrent: true,
        requireAuthorizationEvidence: true,
        label: "Historical policy delivery",
        path: [manifestBundle(revoked)],
        principalPolicyCache: new Map(),
        resolveUserKey: data.resolveTrustedUserIdentity,
        verifiedByHash,
      });
      expect(verified.at(-1)?.manifestHash).toBe(revoked.manifestHash);
      expect(verifiedByHash.has(root.manifestHash)).toBe(true);
      recorder.record({
        action: "HonestSync",
        device: deleted ? "d2" : "d1",
        observed: { outcome: "accepted" },
      });
    } finally {
      database.close();
    }
  }
  persistNoBrickTrace(recorder.trace());
});
