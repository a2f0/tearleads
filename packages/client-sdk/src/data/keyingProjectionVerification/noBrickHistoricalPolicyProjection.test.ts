import { expect, test } from "bun:test";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import { createContainerManifestFixture } from "@tearleads/crypto/test-fixtures";
import {
  createNativeTestExecSql,
  createNoBrickTraceRecorder,
  persistNoBrickTrace,
} from "@tearleads/test-utils";
import { manifestBundle } from "../../../test/helpers/ancestorCitationScenario";
import {
  createOrganizationHistoryFixture,
  policySnapshot,
} from "../../../test/helpers/organizationPolicyHistory";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { verifyContainerDestinationProjection } from "./containerDestinationVerification";
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
  const bundle = manifestBundle(root);
  const recorder = createNoBrickTraceRecorder("historical-policy-delivery", {
    d1: 0,
    d2: 0,
  });
  recorder.record({ action: "AdvanceAuthority" });
  recorder.record({ action: "DropAuthorityReference" });
  for (const deleted of [false, true]) {
    if (deleted) recorder.record({ action: "DeleteAuthority" });
    const database = createNativeTestExecSql();
    const history = data.evidence(deleted);
    try {
      const policies = await verifyProjectionPolicyEvidence({
        execSql: database.execSql,
        organizationId: data.organizationId,
        resolveUserKey: data.resolveTrustedUserIdentity,
        evidence: {
          organization: policySnapshot(
            deleted ? data.afterDeletion : data.afterAddition,
          ),
          organizationPayloads: history.organizationPayloads,
          groups: history.groups,
        },
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
      const verified = await verifyContainerDestinationProjection({
        execSql: database.execSql,
        projection: {
          containerId,
          organizationId: data.organizationId,
          path: [bundle],
          containerKeks: [],
          policyEvidence: {
            organization: policySnapshot(
              deleted ? data.afterDeletion : data.afterAddition,
            ),
            organizationPayloads: history.organizationPayloads,
            groups: history.groups,
          },
        },
        resolveUserKey: data.resolveTrustedUserIdentity,
      });
      expect(verified.path.at(-1)?.manifestHash).toBe(root.manifestHash);
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
