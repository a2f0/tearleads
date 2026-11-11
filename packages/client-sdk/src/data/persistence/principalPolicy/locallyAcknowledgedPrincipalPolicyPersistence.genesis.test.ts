import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { buildInitialGroupPolicyRequest } from "../../../../test/helpers/groupMetadata";
import {
  policyBundleFromInitialRequest,
  signedPrincipalPolicyBundle,
} from "../../../../test/helpers/principalPolicyFixtures";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  persistLocallyAcknowledgedPrincipalPolicyBundles,
  seedLocallyAcknowledgedPrincipalPolicyBundles,
} from "./locallyAcknowledgedPrincipalPolicyPersistence";

async function policyFixture() {
  const signing = generateSigningSeedAndKeyPair();
  const request = await buildInitialGroupPolicyRequest({
    identityTrustDomain: "https://api.example.test",
    creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
    groupId: crypto.randomUUID(),
    name: "Genesis guard",
    signerUserId: crypto.randomUUID(),
    signingFingerprint: await toFingerprint(signing.signingPublicKey),
    signingKeyPair: signing,
  });
  const bundle = await policyBundleFromInitialRequest(request);
  const sign = (
    current: PrincipalPolicyBundleResponse,
    version: number,
    prevStateHash: string | null,
    previousStates: PrincipalPolicyBundleResponse["previousStates"] = [],
  ) =>
    signedPrincipalPolicyBundle({
      memberEnvelopes: current.currentMemberEnvelopes.envelopes,
      payloadCiphertext: current.currentPayload.ciphertext,
      projection: current.currentProjection,
      previousStates,
      signing: {
        ...current.currentState,
        grants: current.currentGrants,
        version,
        prevStateHash,
      },
      signingPrivateKey: signing.signingPrivateKey,
    });
  return { bundle, sign };
}

// This seam receives locally authored policy evidence. Keep bundle, history,
// payload and checkpoint consistent so rejection reaches the genesis guard.
function entry(bundle: PrincipalPolicyBundleResponse) {
  const state = bundle.currentState;
  return {
    bundle,
    policy: makeVerifiedPrincipalPolicy({
      ...state,
      state,
      grants: bundle.currentGrants,
      projection: bundle.currentProjection,
      history: [
        ...bundle.previousStates,
        {
          state,
          grants: bundle.currentGrants,
          projection: bundle.currentProjection,
        },
      ],
      checkpoint: {
        principalType: state.principalType,
        principalId: state.principalId,
        stateHash: state.stateHash,
        version: state.version,
      },
    }),
  };
}

async function policyRows(execSql: ExecSql) {
  return {
    checkpoints: await execSql(
      "SELECT * FROM principal_policy_checkpoints ORDER BY principal_id",
    ),
    bundles: await execSql(
      "SELECT * FROM principal_policy_bundles ORDER BY principal_id, state_hash",
    ),
    references: await execSql(
      "SELECT * FROM principal_policy_bundle_references ORDER BY principal_id, version, state_hash, bundle_state_hash",
    ),
  };
}

test.each([
  { name: "non-genesis version", version: 2, prevStateHash: null },
  {
    name: "genesis with a predecessor",
    version: 1,
    prevStateHash: "f".repeat(64),
  },
])(
  "registration policy rejects $name before seeding any sibling",
  async ({ version, prevStateHash }) => {
    const { close, execSql } = await createTestExecSql(
      "registration-policy-guard",
    );
    try {
      const fixture = await policyFixture();
      const sibling = await policyFixture();
      const options = {
        execSql,
        organizationId: "registration-organization",
        updatedAt: "2026-10-01T00:00:00.000Z",
      };
      let current = fixture.bundle;
      await persistLocallyAcknowledgedPrincipalPolicyBundles({
        ...options,
        entries: [entry(current)],
      });
      for (const nextVersion of [2, 3]) {
        current = await fixture.sign(
          current,
          nextVersion,
          current.currentState.stateHash,
          [
            ...current.previousStates,
            {
              state: current.currentState,
              grants: current.currentGrants,
              projection: current.currentProjection,
            },
          ],
        );
        await persistLocallyAcknowledgedPrincipalPolicyBundles({
          ...options,
          entries: [entry(current)],
        });
      }
      // A newer pin bypasses ordinary checkpoint verification. Neither malformed
      // genesis case may hide in that retained-policy branch.
      await seedLocallyAcknowledgedPrincipalPolicyBundles({
        ...options,
        entries: [entry(fixture.bundle)],
      });
      const before = await policyRows(execSql);
      expect(before.checkpoints).toMatchObject([
        { version: 3, state_hash: current.currentState.stateHash },
      ]);
      expect(before.bundles).toHaveLength(3);
      expect(before.references.length).toBeGreaterThan(0);
      const malformed = await fixture.sign(
        fixture.bundle,
        version,
        prevStateHash,
      );
      const error = await seedLocallyAcknowledgedPrincipalPolicyBundles({
        ...options,
        entries: [entry(sibling.bundle), entry(malformed)],
      }).then(
        () => null,
        (cause: unknown) => cause,
      );
      expect(error).toMatchObject({
        name: "KeyingVerificationError",
        code: "invalid_shape",
        message: "registration policy must begin at version 1",
      });
      expect(await policyRows(execSql)).toEqual(before);
    } finally {
      close();
    }
  },
);
