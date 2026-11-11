import { expect, test } from "bun:test";
import {
  acknowledgePolicy,
  adoptionAccessHeads,
  organizationAdoptionFixture,
} from "../../../../test/helpers/organizationAdoption";
import { signedPrincipalPolicyBundle } from "../../../../test/helpers/principalPolicyFixtures";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { advanceLocallyAcknowledgedAccessManifestHeadsAtomically } from "../../../data/persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence";

test.each(["container", "document"] as const)(
  "ordinary adoption rejects an equal-epoch %s fork atomically",
  async (kind) => {
    const fixture = await organizationAdoptionFixture();
    const { execSql, request } = fixture;
    try {
      const genesis = (await adoptionAccessHeads(request)).find(
        (head) => head.checkpoint.objectKind === kind,
      );
      if (!genesis) throw new Error("Missing genesis head");
      await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
        execSql,
        heads: [
          {
            ...genesis,
            checkpoint: { ...genesis.checkpoint, manifestHash: "f".repeat(64) },
          },
        ],
      });
      const before = await execSql("SELECT * FROM access_manifest_checkpoints");
      await expect(fixture.retry()).rejects.toMatchObject({
        code: "equivocation",
      });
      expect(
        await execSql("SELECT * FROM access_manifest_checkpoints"),
      ).toEqual(before);
      expect(
        await execSql(
          "SELECT organization_id FROM organization_provisioning_attempts",
        ),
      ).toEqual([{ organization_id: request.organizationId }]);
      expect(
        await sqlContainerContentsPersistence.loadContainers(execSql),
      ).toEqual([]);
    } finally {
      fixture.close();
    }
  },
);

test.each(["admin", "member", "organization"] as const)(
  "ordinary adoption rejects an equal-version %s policy fork atomically",
  async (kind) => {
    const fixture = await organizationAdoptionFixture();
    const { execSql, request } = fixture;
    try {
      const genesis = fixture.policies[kind];
      const fork = await signedPrincipalPolicyBundle({
        memberEnvelopes: genesis.currentMemberEnvelopes.envelopes,
        payloadCiphertext: genesis.currentPayload.ciphertext,
        projection: genesis.currentProjection,
        signing: {
          ...genesis.currentState,
          grants: genesis.currentGrants,
          signedAt: "2001-01-01T00:00:00.000Z",
        },
        signingPrivateKey: fixture.input.signingKeyPair.signingPrivateKey,
      });
      expect(fork.currentState.stateHash).not.toBe(
        genesis.currentState.stateHash,
      );
      await acknowledgePolicy(execSql, request.organizationId, fork);
      const before = await execSql(
        "SELECT * FROM principal_policy_checkpoints",
      );
      await expect(fixture.retry()).rejects.toMatchObject({
        code: "equivocation",
      });
      expect(
        await execSql("SELECT * FROM principal_policy_checkpoints"),
      ).toEqual(before);
      expect(
        await execSql(
          "SELECT organization_id FROM organization_provisioning_attempts",
        ),
      ).toEqual([{ organization_id: request.organizationId }]);
      expect(
        await sqlContainerContentsPersistence.loadContainers(execSql),
      ).toEqual([]);
    } finally {
      fixture.close();
    }
  },
);
